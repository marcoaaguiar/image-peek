import type { EngineInterface, Register } from 'claude-code'

type ImageRead = {
  type: 'image'
  file: { base64: string; type: string; dimensions?: { displayWidth?: number; displayHeight?: number } }
}
type Png = { base64: string; width: number; height: number }

const LINK = /!\[([^\]]*)\]\((\/[^)\s]+\.png)\)/gi
const MAX_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LABEL = /^\s*(?:Figure|Fig\.?)\s+(\d+)\s*[.:]\s*/i
const cache = new Map<string, Png | null>()

const GUIDE = `# Figures in replies

The terminal draws PNG images inline in your replies, with a caption.

- When a picture explains something better than text (a chart, a diagram, a screenshot, a before/after), save it as a PNG of at most 2 MiB and put it on its own line: \`![Figure N. Caption sentence.](/absolute/path.png)\`.
- Number figures in order through the whole session: the first is Figure 1, the next Figure 2, and so on. Never reuse a number.
- Write the caption the way a paper does: one or two sentences that say what the figure shows, so it reads on its own.
- Refer to figures by number in the text, for example: "the display issue (see Figure 12, before) was resolved by adjusting the background color (see Figure 13, after)".
- Use only PNG and an absolute path. Other formats and relative paths show as text.`

// The terminal takes standard padded base64 only; tool output can be URL-safe or unpadded.
const padded = (base64: string): string => {
  const plain = base64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  return plain + '='.repeat((4 - (plain.length % 4)) % 4)
}

const isPng = (output: unknown): output is ImageRead => {
  const read = output as ImageRead | undefined
  return read?.type === 'image' && read.file?.type === 'image/png'
}

const pathOf = (input: unknown): string => String((input as { file_path?: string } | undefined)?.file_path ?? '')

const readsPng = (call: { tool: string; input: unknown }): boolean => call.tool === 'Read' && /\.png$/i.test(pathOf(call.input))

// The PNG header holds width and height as big-endian words at bytes 16 to 23.
const pngSize = (base64: string): { width: number; height: number } => {
  const bits = [...base64.slice(0, 32)].map(char => B64.indexOf(char).toString(2).padStart(6, '0')).join('')
  const byte = (i: number) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const word = (i: number) => ((byte(i) << 24) >>> 0) + (byte(i + 1) << 16) + (byte(i + 2) << 8) + byte(i + 3)
  return { width: word(16), height: word(20) }
}

const load = async ($: EngineInterface, path: string): Promise<Png | null> => {
  if (!cache.has(path)) {
    try {
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      const png = padded(base64)
      cache.set(path, png.length > MAX_BASE64 ? null : { base64: png, ...pngSize(png) })
    } catch {
      cache.set(path, null)
    }
  }
  return cache.get(path) ?? null
}

// A terminal cell is about twice as tall as it is wide.
const cells = (width: number, height: number) => {
  const columns = Math.min(60, Math.max(8, Math.round(width / 8)))
  const rows = Math.min(30, Math.max(2, Math.round((columns * height) / Math.max(1, width) / 2)))
  return { columns, rows }
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.surfaces.includes('terminal')) return composed
    return { sections: [...composed.sections, { id: 'image-peek:figures', text: GUIDE, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'ToolGroup' }, ($, e, next) =>
    !e.props.isExpanded && e.props.calls.some(readsPng)
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
      : next(e),
  )

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    const call = e.props
    if (call.tool !== 'Read' || call.isRunning || call.isErrored || !isPng(call.output)) return row
    const ui = $.ui.resolve(e)
    if (!('Image' in ui)) return row
    const { Box, Image, Text } = ui
    const { base64, dimensions } = call.output.file
    const size = cells(dimensions?.displayWidth ?? 2, dimensions?.displayHeight ?? 1)
    const name = pathOf(call.input).split('/').pop() ?? ''
    return (
      <Box flexDirection="column">
        {row}
        <Box flexDirection="column" paddingLeft={2} width={size.columns + 2}>
          <Image source={{ png: padded(base64) }} {...size} alt={name} />
          <Box justifyContent="center">
            <Text dimColor italic>{name}</Text>
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    const links = [...text.matchAll(LINK)]
    const ui = $.ui.resolve(e)
    if (links.length === 0 || !('Image' in ui)) return next(e)
    const figures = await Promise.all(
      links.map(async (match, i) => ({
        caption: match[1] ?? '',
        png: await load($, match[2] ?? ''),
        after: text.slice((match.index ?? 0) + match[0].length, links[i + 1]?.index ?? text.length).trim(),
      })),
    )
    if (figures.every(figure => figure.png === null)) return next(e)
    const { Box, Image, Text, Markdown } = ui
    const row = await next({ ...e, props: { ...e.props, text: text.slice(0, links[0]?.index ?? 0).trim() || ' ' } })
    return (
      <Box flexDirection="column">
        {row}
        {figures.map(figure => {
          const label = LABEL.exec(figure.caption)
          const caption = label ? figure.caption.slice(label[0].length) : figure.caption
          const size = figure.png && cells(figure.png.width, figure.png.height)
          return (
            <Box flexDirection="column" paddingLeft={2}>
              {figure.png && size ? (
                <Box flexDirection="column" width={Math.max(size.columns, 20)} marginY={1}>
                  <Box justifyContent="center">
                    <Image source={{ png: figure.png.base64 }} {...size} alt={figure.caption || ' '} />
                  </Box>
                  <Text dimColor>
                    {label && <Text bold>Figure {label[1]}. </Text>}
                    <Text italic>{caption}</Text>
                  </Text>
                </Box>
              ) : (
                <Text dimColor>[figure not found: {figure.caption}]</Text>
              )}
              {figure.after && <Markdown text={figure.after} />}
            </Box>
          )
        })}
      </Box>
    )
  })
}
