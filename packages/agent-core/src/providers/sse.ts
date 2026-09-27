export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ''
  const emit = (line: string): string | null => (line.startsWith('data:') ? line.replace(/^data:\s?/, '') : null)
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      const data = emit(line)
      if (data !== null) yield data
    }
  }
  buf += decoder.decode()
  const trailing = emit(buf.replace(/\r$/, ''))
  if (trailing !== null) yield trailing
}
