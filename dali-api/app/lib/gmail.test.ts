import { describe, expect, it } from 'vitest'
import { encodeHeader, makeRawEmail } from './gmail'

function decodeEncodedWords(header: string): string {
  return header
    .split('\r\n ')
    .map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/)
      if (!m) throw new Error(`not an encoded word: ${w}`)
      return Buffer.from(m[1], 'base64')
    })
    .reduce((acc, b) => Buffer.concat([acc, b]), Buffer.alloc(0))
    .toString('utf8')
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8')
}

function headerValue(message: string, name: string): string {
  const m = message.match(new RegExp(`^${name}: ((?:.*)(?:\\r\\n .*)*)`, 'm'))
  if (!m) throw new Error(`missing header ${name}`)
  return m[1]
}

// Returns the decoded body of the first part with the given content type.
function partBody(message: string, contentType: string): string {
  const start = message.indexOf(`Content-Type: ${contentType}`)
  expect(start).toBeGreaterThan(-1)
  const afterHeaders = message.indexOf('\r\n\r\n', start) + 4
  const end = message.indexOf('\r\n--', afterHeaders)
  return Buffer.from(message.slice(afterHeaders, end).replace(/\r\n/g, ''), 'base64').toString('utf8')
}

describe('encodeHeader', () => {
  it('leaves printable ASCII untouched', () => {
    expect(encodeHeader("You're in: CS0 Session 6")).toBe("You're in: CS0 Session 6")
  })

  it('strips CR and LF before encoding', () => {
    expect(encodeHeader('a\r\nBcc: x@y.z')).toBe('aBcc: x@y.z')
  })

  it('encodes emoji as RFC 2047 words that round-trip', () => {
    const subject = "🎉 Congratulations!! You're in for DALI Miniseries: Purpose Lab 🎉"
    const encoded = encodeHeader(subject)
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/)
    expect(PRINTABLE(encoded)).toBe(true)
    expect(decodeEncodedWords(encoded)).toBe(subject)
  })

  it('encodes non-emoji non-ASCII such as the middle dot', () => {
    const subject = 'Upcoming: Session 6 · Friday, Oct 16'
    expect(decodeEncodedWords(encodeHeader(subject))).toBe(subject)
  })

  it('keeps every encoded word at or under 75 characters', () => {
    const subject = '🎉'.repeat(40) + ' é'.repeat(60)
    const words = encodeHeader(subject).split('\r\n ')
    expect(words.length).toBeGreaterThan(1)
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75)
    expect(decodeEncodedWords(encodeHeader(subject))).toBe(subject)
  })

  it('never splits a multi-byte character across words', () => {
    const subject = 'x'.repeat(44) + '🎉'
    const words = encodeHeader(subject).split('\r\n ')
    for (const w of words) {
      const bytes = Buffer.from(w.slice(10, -2), 'base64')
      expect(bytes.toString('utf8')).not.toContain('�')
    }
  })
})

function PRINTABLE(s: string): boolean {
  return /^[\x20-\x7e\r\n]*$/.test(s)
}

describe('makeRawEmail', () => {
  const subject = '🎉 You’re in for Purpose Lab'
  const html = `<!DOCTYPE html><html><body><p>${'Café 🎉 '.repeat(400)}</p></body></html>`

  it('produces a fully ASCII message', () => {
    const msg = decodeRaw(makeRawEmail('a@b.edu', subject, html, 'from@dali.edu'))
    expect(PRINTABLE(msg)).toBe(true)
  })

  it('keeps every line within the 998-character limit', () => {
    const msg = decodeRaw(makeRawEmail('a@b.edu', subject, html, 'from@dali.edu'))
    for (const line of msg.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998)
  })

  it('encodes the subject header so it decodes to the original', () => {
    const msg = decodeRaw(makeRawEmail('a@b.edu', subject, html, 'from@dali.edu'))
    expect(decodeEncodedWords(headerValue(msg, 'Subject'))).toBe(subject)
  })

  it('sends an ASCII subject as-is', () => {
    const msg = decodeRaw(makeRawEmail('a@b.edu', 'Plain subject', html, 'from@dali.edu'))
    expect(headerValue(msg, 'Subject')).toBe('Plain subject')
  })

  it('base64-encodes the html and text parts and they round-trip', () => {
    const msg = decodeRaw(makeRawEmail('a@b.edu', subject, html, 'from@dali.edu', undefined, undefined, 'Hi 🎉 there'))
    expect(msg).toMatch(/Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64/)
    expect(msg).toMatch(/Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64/)
    expect(partBody(msg, 'text/html')).toBe(html)
    expect(partBody(msg, 'text/plain')).toBe('Hi 🎉 there')
  })

  it('keeps ASCII attachment filenames as quoted params', () => {
    const msg = decodeRaw(
      makeRawEmail('a@b.edu', 's', '<p>x</p>', 'f@d.edu', undefined, [
        { filename: 'receipt.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
      ]),
    )
    expect(msg).toContain('Content-Type: application/pdf; name="receipt.pdf"')
    expect(msg).toContain('Content-Disposition: attachment; filename="receipt.pdf"')
  })

  it('encodes non-ASCII attachment filenames per RFC 2231', () => {
    const msg = decodeRaw(
      makeRawEmail('a@b.edu', 's', '<p>x</p>', 'f@d.edu', undefined, [
        { filename: 'Résumé (final).pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
      ]),
    )
    expect(PRINTABLE(msg)).toBe(true)
    const disposition = msg.match(/filename\*=UTF-8''(\S+)/)?.[1]
    expect(decodeURIComponent(disposition!)).toBe('Résumé (final).pdf')
    const name = msg.match(/name="(=\?UTF-8\?B\?[^"]+)"/)?.[1]
    expect(decodeEncodedWords(name!.replace(/\?==\?UTF-8\?B\?/g, '?=\r\n =?UTF-8?B?'))).toBe('Résumé (final).pdf')
  })

  it('replaces quotes in attachment filenames so the param cannot break out', () => {
    const msg = decodeRaw(
      makeRawEmail('a@b.edu', 's', '<p>x</p>', 'f@d.edu', undefined, [
        { filename: 'a"b.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf') },
      ]),
    )
    expect(msg).toContain('filename="a_b.pdf"')
  })
})
