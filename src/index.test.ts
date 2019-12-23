import { schema, CapabilityError } from '@stencila/executa'
import { Basha } from '.'

// Start a new interpreter before each test
// and stop it after each one to ensure that
// tests do not hang if they fail.
let basha: Basha
beforeEach(() => {
  basha = new Basha()
})
afterEach(async () => {
  await basha.stop()
})

const chunk = (text: string): schema.CodeChunk =>
  schema.codeChunk(text, {
    programmingLanguage: 'bash'
  })

test('manifest', async () => {
  await expect(basha.manifest()).resolves.not.toThrow()
})

describe('executeCode', () => {
  // Commands that succeed
  test('commands: ok', async () => {
    expect(await basha.executeCode('echo "Hello world!"')).toBe('Hello world!')
    expect(await basha.executeCode("date --date='@100000000' -u -I")).toBe(
      '1973-03-03'
    )
  })

  // Commands that do not have any output
  test('commands: no output', async () => {
    expect(await basha.executeCode('VAR=value')).toBe(undefined)
    expect(await basha.executeCode('sleep 0.1')).toBe(undefined)
  })

  // Commands that fail
  test('commands: bad', async () => {
    await expect(basha.executeCode('foo')).rejects.toThrow(
      'bash: foo: command not found'
    )
    await expect(basha.executeCode('cat foo.bar')).rejects.toThrow(
      'cat: foo.bar: No such file or directory'
    )
  })

  // Setting and using variables
  test('variables', async () => {
    expect(await basha.executeCode('VAR1=one')).toBe(undefined)
    expect(await basha.executeCode('echo $VAR1')).toBe('one')
  })

  // Control flow
  test('control flow', async () => {
    expect(
      await basha.executeCode(`for i in 1 2 3
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
    await expect(basha.executeCode('for')).rejects.toThrow(
      'bash: syntax error near unexpected token `newline'
    )
  })
})

describe('execute', () => {
  test('code chunk', async () => {
    const chunk = schema.codeChunk('echo \'{"a":1}\'', {
      programmingLanguage: 'bash'
    })
    const executed = await basha.execute(chunk)
    const { outputs, errors } = executed
    expect(outputs).toEqual([{ a: 1 }])
    expect(errors).toBeUndefined()
  })

  test('code expression', async () => {
    const chunk = schema.codeExpression('echo \'{"a":1}\'', {
      programmingLanguage: 'bash'
    })
    const executed = await basha.execute(chunk)
    const { output, errors } = executed
    expect(output).toEqual({ a: 1 })
    expect(errors).toBeUndefined()
  })

  test('parallel code chunks', async () => {
    // Should handle parallel requests

    // Make two requests to execute
    const p1 = basha.execute(
      schema.codeChunk('VAR=first', {
        programmingLanguage: 'bash'
      })
    )
    const p2 = basha.execute(
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
    const executed = await basha.execute(chunk)
    const { outputs, errors } = executed
    expect(outputs).toBeUndefined()
    expect(errors).toEqual([
      schema.codeError('RuntimeError', {
        message: 'bash: foo: command not found'
      })
    ])
  })

  test('duration', async () => {
    const { duration: duration1 } = await basha.execute(
      schema.codeChunk('sleep 0.1', { programmingLanguage: 'bash' })
    )
    expect(duration1).toBeGreaterThanOrEqual(0.1)
    expect(duration1).toBeLessThanOrEqual(0.2)

    const { duration: duration2 } = await basha.execute(
      schema.codeChunk('sleep 0.2', { programmingLanguage: 'bash' })
    )
    expect(duration2).toBeGreaterThanOrEqual(0.2)
    expect(duration2).toBeLessThanOrEqual(0.3)
  })

  // prettier-ignore
  test('incapable', async () => {
    await expect(
      basha.execute(null)
    ).rejects.toThrow(CapabilityError)
    await expect(
      basha.execute(schema.codeChunk(''))
    ).rejects.toThrow(CapabilityError)
    await expect(
      basha.execute(schema.codeChunk('', { programmingLanguage: 'foo' }))
    ).rejects.toThrow(CapabilityError)
  })
})

describe('cancel', () => {
  test('code chunk', async () => {
    // Can't cancel anything other than a current request
    expect(await basha.cancel('job-random')).toBe(false)

    // Set a var to check that we have the same Bash
    // session after cancelling
    const chunk1 = await basha.execute(chunk('VAR=42'))

    // Asynchronously execute a chunk that is meant to sleep for a while
    const chunk2 = chunk('sleep 30')
    basha
      .execute(chunk2, undefined, undefined, 'job-2')
      .then(chunk => {
        // When it cancels it resolves with an error (due to non-zero exit code)
        expect(chunk.outputs).toEqual(['^C'])
      })
      .catch(error => console.error(error))

    // Wait a tiny amount for the previous chunk to finish
    // writing it's input before we cancel it
    await new Promise(resolve => setTimeout(resolve, 10))

    // Now cancel the chunk
    expect(await basha.cancel('job-2')).toBe(true)

    const chunk3 = await basha.execute(
      chunk('echo $VAR'),
      undefined,
      undefined,
      'job-3'
    )
    expect(chunk3.outputs).toEqual([42])
    // Can't cancel it because it is already completed
    expect(await basha.cancel('job-3')).toBe(false)
  })
})

test('exit handling', async () => {
  expect(await basha.executeCode('VAR=1')).toEqual(undefined)
  expect(await basha.executeCode('echo $VAR')).toEqual(1)
  expect(await basha.executeCode('exit')).toEqual('exit')
  // Recovers by creating new bash process, but
  // the env var is no longer set
  expect(await basha.executeCode('echo $VAR')).toEqual('')
})
