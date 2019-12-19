import {
  Capabilities,
  CapabilityError,
  cli,
  JSONSchema7,
  Listener,
  logga,
  Method,
  schema,
  Server,
  StdioServer,
  Claims
} from '@stencila/executa'
import AsyncLock from 'async-lock'
import * as pty from 'node-pty'
import { performance } from 'perf_hooks'

const log = logga.getLogger('basha')

export class Basha extends Listener {
  /**
   * Programming language names supported by this
   * interpreter.
   */
  readonly programmingLanguages = ['bash', 'sh']

  /**
   * The pseudo-terminal in which bash is executed.
   */
  protected terminal?: pty.IPty

  /**
   * The prompt used to identify when the pseudo-
   * terminal has finished executing and is ready
   * for more input.
   */
  readonly prompt = '🔨 BASHA > '

  /**
   * Output from entering the last Bash input.
   *
   * Used to buffer output from the pseudo-terminal.
   */
  private output = ''

  /**
   * Is Bash ready for more input?
   */
  private isReady = false

  /**
   * A lock to prevent async event loops from attempting to enter
   * code into the terminal at the same time.
   */
  private lock = new AsyncLock()

  /**
   * Function to call when Bash is ready
   */
  private whenReady?: () => void

  /**
   * Flag to mute log errors when this interpreter
   * is explicitly `stop()`ed
   */
  private isStopping = false

  /**
   * The id of the current request.
   *
   * Used to enable cancellation of requests by
   * checking that the request being cancelled is
   * the current one.
   */
  protected currentRequest?: string

  constructor(
    servers: Server[] = [
      new StdioServer({ command: 'node', args: [__filename, 'start'] })
    ]
  ) {
    super('ba', servers)
  }

  /**
   * @override Override of `Executor.capabilities` to
   * define this interpreter's capabilities.
   */
  public capabilities(): Promise<Capabilities> {
    const params: JSONSchema7 = {
      required: ['node'],
      properties: {
        node: {
          required: ['type', 'programmingLanguage', 'text'],
          properties: {
            type: {
              enum: ['CodeChunk', 'CodeExpression']
            },
            programmingLanguage: {
              enum: this.programmingLanguages
            },
            text: {
              type: 'string'
            }
          }
        }
      }
    }
    return Promise.resolve({
      manifest: true,
      compile: params,
      execute: params
    })
  }

  /**
   * @override Override of `Executor.execute` that executes Bash code.
   *
   * Calculates the duration of the execution to the nearest microsecond.
   */
  public async execute<Type>(
    node: Type,
    session?: schema.SoftwareSession,
    claims?: Claims,
    request?: string
  ): Promise<Type> {
    if (schema.isA('CodeChunk', node) || schema.isA('CodeExpression', node)) {
      const { programmingLanguage = '', text } = node
      if (
        typeof text === 'string' &&
        this.programmingLanguages.includes(programmingLanguage)
      ) {
        this.currentRequest = request

        let output
        let errors
        let duration
        try {
          const before = performance.now()
          output = await this.executeCode(text)
          duration = Math.round((performance.now() - before) * 1e3) / 1e6
        } catch (error) {
          const { message } = error
          errors = [schema.codeError('RuntimeError', { message })]
        }

        this.currentRequest = undefined

        let executed
        if (schema.isA('CodeChunk', node)) {
          const outputs = output !== undefined ? [output] : undefined
          executed = { ...node, outputs, errors, duration }
        } else {
          executed = { ...node, output, errors }
        }
        return executed
      }
    }
    throw new CapabilityError(undefined, Method.execute, { node })
  }

  /**
   * @override Override of `Executor.cancel` that cancels the
   * current request only.
   */
  public cancel(request: string): Promise<boolean> {
    if (
      this.terminal !== undefined &&
      request !== undefined &&
      request === this.currentRequest &&
      !this.isReady
    ) {
      // Send the equivalent of Ctrl+C keypress to the terminal
      // It this is pressed while there is no command running then Bash
      // itself will exit.
      log.debug('Interrupting the current process')
      if (this.terminal !== undefined) this.terminal.write('\x03')
      return Promise.resolve(true)
    }
    return Promise.resolve(false)
  }

  /**
   * Start a Bash shell process.
   *
   * Creates a pseudo-terminal and registers
   * event handles on it to capture output and
   * handle unexpected exit.
   */
  public startBash(): pty.IPty {
    log.debug(`Starting bash`)

    const terminal = (this.terminal = pty.spawn(
      'bash',
      // Use `--norc` to prevent loading of resource file which
      // may overwrite `PS1` and cause this to fail
      ['--norc'],
      {
        env: {
          // Use custom prompt to be able to detect readiness
          PS1: this.prompt
        }
      }
    ))

    terminal.onData((data: string) => {
      if (data.endsWith(this.prompt)) {
        this.output += data.slice(0, -this.prompt.length)
        this.isReady = true
        if (this.whenReady !== undefined) this.whenReady()
      } else {
        this.output += data
      }
    })

    terminal.onExit(() => {
      if (!this.isStopping) log.error(`Bash exited prematurely`)
      if (this.whenReady !== undefined) this.whenReady()
      this.terminal = undefined
    })

    return terminal
  }

  /**
   * Enter Bash code into the terminal and set up handler to
   * process output.
   *
   * @param code Code to enter.
   * @returns A promise resolving to the output.
   */
  public async enterCode(code: string): Promise<string> {
    return this.lock.acquire('terminal', () => {
      const terminal =
        this.terminal === undefined ? this.startBash() : this.terminal
      const input = code + '\r'
      const enter = (resolve: (output: string) => void): void => {
        this.whenReady = () => {
          let output = this.output
          // Remove the echoed input from start (including return)
          if (output.startsWith(input)) output = output.slice(input.length + 1)
          // Remove any carriage returns
          output = output.replace(/\r/g, '')
          // Remove the newline from end
          if (output.endsWith('\n')) output = output.slice(0, -1)
          resolve(output)
        }
        terminal.write(input)
        this.output = ''
        this.isReady = false
      }
      return this.isReady
        ? new Promise<string>(resolve => enter(resolve))
        : new Promise<string>(
            resolve => (this.whenReady = () => enter(resolve))
          )
    })
  }

  /**
   * Execute Bash code.
   *
   * This method enters the code, parses the output and
   * checks the exit code. If the exit code is non-zero
   * if throws an error with the output.
   *
   * @param code Code to execute
   * @returns A promise resolving to the output from the command.
   */
  async executeCode(code: string): Promise<string> {
    const output = await this.enterCode(code)
    const result = this.parseOutput(output)
    const exitCode = await this.enterCode('echo $?')
    if (exitCode === '0') return result
    else throw new Error(result)
  }

  /**
   * Parse output from a command.
   *
   * Attempts to parse the output as JSON.
   * In the future, more advanced parsing
   * such as parsing of fixed-width tables
   * may be done.
   *
   * @param output Output string to parse
   */
  parseOutput(output: string): string {
    try {
      return JSON.parse(output)
    } catch {
      return output
    }
  }

  /**
   * @override Override of `Listener.stop` to
   * stop the pseudo-terminal as well as servers.
   */
  async stop(): Promise<void> {
    await super.stop()

    log.debug(`Stopping bash`)
    if (this.terminal !== undefined) {
      this.isStopping = true
      this.terminal.kill()
      this.terminal = undefined
    }
  }
}

// istanbul ignore next
if (require.main === module)
  cli.main(new Basha()).catch(error => log.error(error))
