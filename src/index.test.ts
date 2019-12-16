import { schema, Method, CapabilityError } from '@stencila/executa'
import { BashInterpreter } from '.'

// Start a new interpreter before each test
// and stop it after each one to ensure that
// tests do not hang if they fail.
let bash = new BashInterpreter()
beforeEach(() => {
  bash = new BashInterpreter()
})
afterEach(async () => {
  await bash.stop()
})

test('register', async () => {
  expect(await bash.register()).toBeUndefined()
})

describe('executeCode', () => {
  // Commands that succeed
  test('commands: ok', async () => {
    expect(await bash.executeCode('echo "Hello world!"')).toBe('Hello world!')
    expect(await bash.executeCode("date --date='@100000000' -u -I")).toBe(
      '1973-03-03'
    )
  })

  // Commands that fail
  test('commands: bad', async () => {
    await expect(bash.executeCode('foo')).rejects.toThrow(
      'bash: foo: command not found'
    )
    await expect(bash.executeCode('cat foo.bar')).rejects.toThrow(
      'cat: foo.bar: No such file or directory'
    )
  })

  // Setting and using variables
  test('variables', async () => {
    expect(await bash.executeCode('VAR1=one')).toBe('')
    expect(await bash.executeCode('echo $VAR1')).toBe('one')
  })

  // Control flow
  test('control flow', async () => {
    expect(
      await bash.executeCode(`for i in 1 2 3
do
  echo "Hello $i times"
done`)
    ).toBe(`for i in 1 2 3
> do
>   echo "Hello $i times"
> done
Hello 1 times
Hello 2 times
Hello 3 times`)
  })

  // Syntax errors
  test('syntax errors', async () => {
    await expect(bash.executeCode('for')).rejects.toThrow(
      'bash: syntax error near unexpected token `newline'
    )
  })
})

describe('execute', () => {
  test('code chunk', async () => {
    const chunk = schema.codeChunk('echo \'{"a":1}\'', {
      programmingLanguage: 'bash'
    })
    const executed = await bash.execute(chunk)
    const { outputs, errors } = executed
    expect(outputs).toEqual([{ a: 1 }])
    expect(errors).toBeUndefined()
  })

  test('code expression', async () => {
    const chunk = schema.codeExpression('echo \'{"a":1}\'', {
      programmingLanguage: 'bash'
    })
    const executed = await bash.execute(chunk)
    const { output, errors } = executed
    expect(output).toEqual({ a: 1 })
    expect(errors).toBeUndefined()
  })

  test('parallel code chunks', async () => {
    // Should handle parallel requests

    // Make two requests to execute
    const p1 = bash.execute(
      schema.codeChunk('VAR=first', {
        programmingLanguage: 'bash'
      })
    )
    const p2 = bash.execute(
      schema.codeChunk('echo $VAR', {
        programmingLanguage: 'bash'
      })
    )

    // Wait for them and check that the second ran after the first
    await p1
    const { outputs } = await p2
    expect(outputs).toEqual(['first'])
  })

  test('errors', async () => {
    const chunk = schema.codeChunk('foo', { programmingLanguage: 'bash' })
    const executed = await bash.execute(chunk)
    const { outputs, errors } = executed
    expect(outputs).toBeUndefined()
    expect(errors).toEqual([
      schema.codeError('execute', { message: 'bash: foo: command not found' })
    ])
  })

  test('duration', async () => {
    const { duration: duration1 } = await bash.execute(
      schema.codeChunk('sleep 0.1', { programmingLanguage: 'bash' })
    )
    expect(duration1).toBeGreaterThanOrEqual(0.1)
    expect(duration1).toBeLessThanOrEqual(0.2)

    const { duration: duration2 } = await bash.execute(
      schema.codeChunk('sleep 0.2', { programmingLanguage: 'bash' })
    )
    expect(duration2).toBeGreaterThanOrEqual(0.2)
    expect(duration2).toBeLessThanOrEqual(0.3)
  })

  // prettier-ignore
  test('incapable', async () => {
    await expect(
      bash.execute(null)
    ).rejects.toThrow(CapabilityError)
    await expect(
      bash.execute(schema.codeChunk(''))
    ).rejects.toThrow(CapabilityError)
    await expect(
      bash.execute(schema.codeChunk('', { programmingLanguage: 'foo' }))
    ).rejects.toThrow(CapabilityError)
  })
})

test('exit handling', async () => {
  expect(await bash.executeCode('VAR=1')).toEqual('')
  expect(await bash.executeCode('echo $VAR')).toEqual(1)
  expect(await bash.executeCode('exit')).toEqual('exit')
  // Recovers by creating new bash process, but
  // the env var is no longer set
  expect(await bash.executeCode('echo $VAR')).toEqual('')
})
