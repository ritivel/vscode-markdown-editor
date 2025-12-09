import { parseFrontmatter, PageSettings } from './page-settings'
import { t } from './lang'

/**
 * Convert markdown to HTML for export
 */
function markdownToHtml(markdown: string): string {
  // Simple markdown to HTML converter
  // This is a basic implementation - in production you might want to use a library
  // But we're avoiding external dependencies per requirements

  let html = markdown

  // Convert page breaks
  html = html.replace(/<!--\s*page[- ]?break\s*-->/gi, '<div class="page-break"></div>')

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>')

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.*?)_/g, '<em>$1</em>')

  // Code blocks
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```[\w]*\n?/g, '').replace(/```/g, '')
    return `<pre><code>${escapeHtml(code)}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')

  // Lists
  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>')
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>')
  html = html.replace(/^(\d+)\. (.*$)/gim, '<li>$2</li>')

  // Wrap consecutive list items
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    if (match.match(/^\d+\./)) {
      return `<ol>${match}</ol>`
    }
    return `<ul>${match}</ul>`
  })

  // Blockquotes
  html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>')
  html = html.replace(/^\*\*\*$/gim, '<hr>')

  // Paragraphs (lines that don't match other patterns)
  html = html.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('<')) return trimmed
    return `<p>${trimmed}</p>`
  }).join('\n')

  return html
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Export to PDF using browser print functionality
 */
export async function exportToPdf(markdown: string): Promise<void> {
  try {
    const { frontmatter, body } = parseFrontmatter(markdown)
    const html = markdownToHtml(body)

    // Create a hidden iframe for printing
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = 'none'
    document.body.appendChild(iframe)

    const printWindow = iframe.contentWindow!
    const printDoc = printWindow.document!

    // Build print HTML with page settings
    const printHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      margin: 2cm 1.5cm;
      ${frontmatter.header ? `@top-center { content: "${frontmatter.header.replace(/"/g, '\\"')}"; }` : ''}
      ${frontmatter.footer ? `@bottom-center { content: "${frontmatter.footer.replace(/"/g, '\\"')}"; }` : ''}
      ${frontmatter.pageNumbers === 'left' ? '@bottom-left { content: counter(page); }' : ''}
      ${frontmatter.pageNumbers === 'center' ? '@bottom-center { content: counter(page); }' : ''}
      ${frontmatter.pageNumbers === 'right' ? '@bottom-right { content: counter(page); }' : ''}
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }

    .page-break {
      page-break-after: always;
      border-top: 2px dashed #ccc;
      margin: 20px 0;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }

    h1 { font-size: 2em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #666; padding-bottom: 0.2em; }
    h3 { font-size: 1.25em; }

    p { margin: 1em 0; }

    ul, ol { margin: 1em 0; padding-left: 2em; }

    blockquote {
      border-left: 4px solid #ccc;
      padding-left: 1em;
      margin: 1em 0;
      color: #666;
    }

    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }

    pre {
      background: #f4f4f4;
      padding: 1em;
      border-radius: 5px;
      overflow-x: auto;
    }

    pre code {
      background: none;
      padding: 0;
    }

    img {
      max-width: 100%;
      height: auto;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }

    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }

    th {
      background-color: #f2f2f2;
      font-weight: bold;
    }

    @media print {
      .page-break {
        page-break-after: always;
        border: none;
      }
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>
    `

    printDoc.open()
    printDoc.write(printHtml)
    printDoc.close()

    // Wait for iframe to load, then print
    await new Promise(resolve => setTimeout(resolve, 500))

    printWindow.focus()
    printWindow.print()

    // Clean up after a delay
    setTimeout(() => {
      document.body.removeChild(iframe)
    }, 1000)

    vscode.postMessage({
      command: 'info',
      content: t('exportSuccess'),
    })
  } catch (error: any) {
    vscode.postMessage({
      command: 'error',
      content: `${t('exportError')}: ${error.message}`,
    })
  }
}

/**
 * Simple CRC-32 calculation
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Create a simple ZIP file structure (for DOCX)
 */
function createZipFile(files: { name: string; content: string }[]): Blob {
  // Minimal ZIP implementation without external dependencies
  const localHeaders: Uint8Array[] = []
  const fileData: Uint8Array[] = []
  const centralDirEntries: Uint8Array[] = []

  let offset = 0

  for (const file of files) {
    const content = new TextEncoder().encode(file.content)
    const nameBytes = new TextEncoder().encode(file.name)
    const crc = crc32(content)

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true) // Local file header signature
    localView.setUint16(4, 20, true) // Version needed
    localView.setUint16(6, 0, true) // General purpose bit flag
    localView.setUint16(8, 0, true) // Compression method (0 = stored)
    localView.setUint16(10, 0, true) // Last mod time
    localView.setUint16(12, 0, true) // Last mod date
    localView.setUint32(14, crc, true) // CRC-32
    localView.setUint32(18, content.length, true) // Compressed size
    localView.setUint32(22, content.length, true) // Uncompressed size
    localView.setUint16(26, nameBytes.length, true) // Filename length
    localView.setUint16(28, 0, true) // Extra field length
    localHeader.set(nameBytes, 30)

    localHeaders.push(localHeader)
    fileData.push(content)

    // Central directory entry
    const centralEntry = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralEntry.buffer)
    centralView.setUint32(0, 0x02014b50, true) // Central file header signature
    centralView.setUint16(4, 20, true) // Version made by
    centralView.setUint16(6, 20, true) // Version needed
    centralView.setUint16(8, 0, true) // General purpose bit flag
    centralView.setUint16(10, 0, true) // Compression method
    centralView.setUint16(12, 0, true) // Last mod time
    centralView.setUint16(14, 0, true) // Last mod date
    centralView.setUint32(16, crc, true) // CRC-32
    centralView.setUint32(20, content.length, true) // Compressed size
    centralView.setUint32(24, content.length, true) // Uncompressed size
    centralView.setUint16(28, nameBytes.length, true) // Filename length
    centralView.setUint16(30, 0, true) // Extra field length
    centralView.setUint16(32, 0, true) // File comment length
    centralView.setUint16(34, 0, true) // Disk number start
    centralView.setUint16(36, 0, true) // Internal file attributes
    centralView.setUint32(38, 0, true) // External file attributes
    centralView.setUint32(42, offset, true) // Relative offset of local header
    centralEntry.set(nameBytes, 46)

    centralDirEntries.push(centralEntry)

    offset += localHeader.length + content.length
  }

  // End of central directory record
  const centralDirStart = offset
  const centralDirSize = centralDirEntries.reduce((sum, e) => sum + e.length, 0)

  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  endView.setUint32(0, 0x06054b50, true) // End of central dir signature
  endView.setUint16(4, 0, true) // Number of this disk
  endView.setUint16(6, 0, true) // Disk with start of central dir
  endView.setUint16(8, files.length, true) // Number of central dir records on this disk
  endView.setUint16(10, files.length, true) // Total number of central dir records
  endView.setUint32(12, centralDirSize, true) // Size of central directory
  endView.setUint32(16, centralDirStart, true) // Offset of start of central directory
  endView.setUint16(20, 0, true) // ZIP file comment length

  // Combine all parts
  const parts = [...localHeaders, ...fileData, ...centralDirEntries, endRecord]
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let resultOffset = 0
  for (const part of parts) {
    result.set(part, resultOffset)
    resultOffset += part.length
  }

  return new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert markdown to DOCX OOXML format
 */
function markdownToDocx(markdown: string, settings: PageSettings): string {
  const { body } = parseFrontmatter(markdown)
  const html = markdownToHtml(body)

  // Convert HTML to OOXML Word format
  // This is a simplified conversion
  let ooxml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>`

  // Split by page breaks and paragraphs
  const parts = html.split(/<div class="page-break"><\/div>/)

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    // Extract text content from HTML and escape XML
    const extractText = (html: string): string => {
      const div = document.createElement('div')
      div.innerHTML = html
      return div.textContent || div.innerText || ''
    }

    // Convert HTML elements to OOXML - simplified approach
    let processed = part
      // Headers
      .replace(/<h1>(.*?)<\/h1>/g, (_, text) => {
        const cleanText = extractText(text)
        return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
      })
      .replace(/<h2>(.*?)<\/h2>/g, (_, text) => {
        const cleanText = extractText(text)
        return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
      })
      .replace(/<h3>(.*?)<\/h3>/g, (_, text) => {
        const cleanText = extractText(text)
        return `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
      })
      // Paragraphs
      .replace(/<p>(.*?)<\/p>/g, (_, text) => {
        const cleanText = extractText(text)
        if (cleanText) {
          return `<w:p><w:r><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
        }
        return ''
      })
      // Lists
      .replace(/<ul>(.*?)<\/ul>/gs, (_, content) => {
        const items = content.match(/<li>(.*?)<\/li>/g) || []
        return items.map((item: string) => {
          const text = extractText(item)
          return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
        }).join('')
      })
      .replace(/<ol>(.*?)<\/ol>/gs, (_, content) => {
        const items = content.match(/<li>(.*?)<\/li>/g) || []
        return items.map((item: string) => {
          const text = extractText(item)
          return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
        }).join('')
      })
      .replace(/<li>(.*?)<\/li>/g, (_, text) => {
        const cleanText = extractText(text)
        return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
      })
      // Blockquotes
      .replace(/<blockquote>(.*?)<\/blockquote>/g, (_, text) => {
        const cleanText = extractText(text)
        return `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
      })
      // Code blocks
      .replace(/<pre><code>(.*?)<\/code><\/pre>/gs, (_, text) => {
        const cleanText = extractText(text)
        return `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>${escapeXml(cleanText)}</w:t></w:r></w:p>`
      })

    // If no HTML tags matched, treat as plain text
    if (!processed.match(/<w:p>/)) {
      const text = extractText(part)
      if (text.trim()) {
        processed = `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
      }
    }

    ooxml += processed

    // Add page break if not last part
    if (i < parts.length - 1) {
      ooxml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    }
  }

  ooxml += `  </w:body>
</w:document>`

  return ooxml
}

/**
 * Export to DOCX format
 */
export async function exportToDocx(markdown: string, filename: string = 'document.docx'): Promise<void> {
  try {
    const { frontmatter } = parseFrontmatter(markdown)
    const documentXml = markdownToDocx(markdown, frontmatter)

    // Create DOCX structure files
    const files = [
      {
        name: '[Content_Types].xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
      },
      {
        name: '_rels/.rels',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
      },
      {
        name: 'word/document.xml',
        content: documentXml
      },
      {
        name: 'word/_rels/document.xml.rels',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
      }
    ]

    // Create ZIP file
    const zipBlob = createZipFile(files)

    // Download the file
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    vscode.postMessage({
      command: 'info',
      content: t('exportSuccess'),
    })
  } catch (error: any) {
    vscode.postMessage({
      command: 'error',
      content: `${t('exportError')}: ${error.message}`,
    })
  }
}

