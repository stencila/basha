import {
  CapabilityError,
  JSONSchema7,
  Listener,
  logga,
  Manifest,
  Method,
  Params,
  schema,
  Server,
  StdioServer
} from '@stencila/executa'
import * as pty from 'node-pty'

const log = logga.getLogger('basha')

export class BashInterpreter extends Listener {
  protected child?: pty.IPty

  /**
   * Programming language names supported by this
   * interpreter.
   */
  readonly programmingLanguages = ['bash', 'sh']

  /**
   * The prompt used to identify when the pseudo-
   * terminal has finished executing and is ready
   * for more input.
   */
  readonly prompt = '🔨 BASHA > '

  private output = ''

  private isReady = false

  private whenReady?: () => void

  private isStopping = false

  constructor(
    servers: Server[] = [
      new StdioServer({ command: 'node', args: [__filename] })
    ]
  ) {
    super(servers)
  }

  public async manifest(): Promise<Manifest> {
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
    return {
      addresses: await this.addresses(),
      capabilities: {
        compile: params,
        execute: params
      }
    }
  }

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
            output = this.parseOutput(await this.executeCode(text))
          } catch (error) {
            const { message } = error
            errors = [schema.codeError('execute', { message })]
          }

          if (output !== undefined) output = this.parseOutput(output)

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

  startBash(): pty.IPty {
    log.debug(`Starting bash`)

    const child = (this.child = pty.spawn(
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

    child.onData((data: string) => {
      if (data.endsWith(this.prompt)) {
        this.output += data.slice(0, -this.prompt.length)
        this.isReady = true
        if (this.whenReady !== undefined) this.whenReady()
      } else {
        this.output += data
      }
    })

    child.onExit(() => {
      if (!this.isStopping) log.error(`Bash exited prematurely`)
      if (this.whenReady !== undefined) this.whenReady()
      this.child = undefined
    })

    return child
  }

  enterCode(code: string): Promise<string> {
    const child = this.child === undefined ? this.startBash() : this.child
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
      child.write(input)
    }
    return this.isReady
      ? new Promise(resolve => enter(resolve))
      : new Promise(resolve => (this.whenReady = () => enter(resolve)))
  }

  async executeCode(code: string): Promise<string> {
    const output = await this.enterCode(code)
    const exitCode = await this.enterCode('echo $?')
    if (exitCode === '0') return output
    else throw new Error(output)
  }

  parseOutput(output: string): string {
    try {
      return JSON.parse(output)
    } catch {
      return output
    }
  }

  async stop(): Promise<void> {
    await super.stop()

    log.debug(`Stopping bash`)
    if (this.child !== undefined) {
      this.isStopping = true
      this.child.kill()
      this.child = undefined
    }
  }
}

/* istanbul ignore next */
if (require.main === module) {
  const bash = new BashInterpreter()
  if (process.argv[2] === 'register') {
    bash
      .manifest()
      .then(manifest => StdioServer.register('basha', manifest))
      .catch(error => log.error(error))
  } else {
    bash.start().catch(error => log.error(error))
  }
}
