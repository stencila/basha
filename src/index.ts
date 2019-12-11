import {
  CapabilityError,
  JSONSchema7,
  Listener,
  logga,
  Method,
  Params,
  schema,
  Server,
  StdioServer,
  Capabilities
} from '@stencila/executa'
import * as pty from 'node-pty'

const log = logga.getLogger('basha')

export class BashInterpreter extends Listener {
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
   * Function to call when Bash is ready
   */
  private whenReady?: () => void

  /**
   * Flag to mute log errors when this interpreter
   * is explicitly `stop()`ed
   */
  private isStopping = false

  constructor(
    servers: Server[] = [
      new StdioServer({ command: 'node', args: [__filename] })
    ]
  ) {
    super('ba', servers)
  }

  /**
   * Register this interpreter so that it can
   * be discovered by other executors.
   */
  public async register(): Promise<void> {
    StdioServer.register('basha', await this.manifest())
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
   * @override Override of `Executor.call` that handles method calls.
   *
   * @description This is the main entry point method which dispatches
   * to lower level methods for handling of actual execution and parsing
   * of output.
   */
  public async call<Type>(method: Method, params: Params = {}): Promise<Type> {
    if (method === Method.execute) {
      const { node } = params
      if (schema.isA('CodeChunk', node) || schema.isA('CodeExpression', node)) {
        const { programmingLanguage = '', text } = node
        if (
          typeof text === 'string' &&
          this.programmingLanguages.includes(programmingLanguage)
        ) {
          let output
          let errors
          try {
            output = await this.executeCode(text)
          } catch (error) {
            const { message } = error
            errors = [schema.codeError('execute', { message })]
          }

          let executed
          if (schema.isA('CodeChunk', node)) {
            const outputs = output !== undefined ? [output] : undefined
            executed = { ...node, outputs, errors }
          } else {
            executed = { ...node, output, errors }
          }
          return (executed as unknown) as Type
        }
      }
    }
    throw new CapabilityError(method, params)
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
  public enterCode(code: string): Promise<string> {
    const terminal =
      this.terminal === undefined ? this.startBash() : this.terminal
    const input = code + '\r'
    const enter = (resolve: (output: string) => void): void => {
      this.output = ''
      this.isReady = false
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
    }
    return this.isReady
      ? new Promise(resolve => enter(resolve))
      : new Promise(resolve => (this.whenReady = () => enter(resolve)))
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

/**
 * Create a `BashInterpreter` and run one of it's methods.
 *
 * Used by `npm postinstall` to register this interpreter,
 * and below, to start it.
 *
 * @param method The name of the method to run
 */
export const run = (method: string): void => {
  const instance = new BashInterpreter()
  /* eslint-disable @typescript-eslint/unbound-method */
  const func = method === 'register' ? instance.register : instance.start
  func.apply(instance).catch(error => log.error(error))
}

// Default to running `start`
if (require.main === module) {
  let command = process.argv[2]
  if (command === undefined) command = 'start'
  run(command)
}
