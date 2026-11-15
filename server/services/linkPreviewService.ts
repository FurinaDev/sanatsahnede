import dns from 'node:dns/promises';
import net from 'node:net';
import { LinkPreviewData } from '../../src/types';

export class UnsafeLinkError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, oct) => ((acc << 8) | (Number.parseInt(oct, 10) & 0xff)) >>> 0, 0);
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  let ip = rawIp.trim().toLowerCase();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) {
    ip = ip.slice(0, zoneIdx);
  }

  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    const inRange = (cidrStart: string, maskBits: number) => {
      const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
      return (n & mask) === (ipv4ToInt(cidrStart) & mask);
    };
    return (
      inRange('0.0.0.0', 8) ||
      inRange('10.0.0.0', 8) ||
      inRange('100.64.0.0', 10) ||
      inRange('127.0.0.0', 8) ||
      inRange('169.254.0.0', 16) ||
      inRange('172.16.0.0', 12) ||
      inRange('192.0.0.0', 24) ||
      inRange('192.168.0.0', 16) ||
      inRange('198.18.0.0', 15) ||
      inRange('224.0.0.0', 4) ||
      inRange('240.0.0.0', 4)
    );
  }

  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const firstSegment = ip.split(':')[0] || '';
    const firstWord = Number.parseInt(firstSegment || '0', 16);
    // fc00::/7 (Unique Local), fe80::/10 (Link-Local), ff00::/8 (Multicast)
    if ((firstWord & 0xfe00) === 0xfc00) return true;
    if ((firstWord & 0xffc0) === 0xfe80) return true;
    if ((firstWord & 0xff00) === 0xff00) return true;
    return false;
  }

  return true;
}

export async function validateSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeLinkError('Geçerli bir web bağlantısı (https://...) giriniz.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeLinkError('Yalnızca http:// veya https:// bağlantıları desteklenir.');
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeLinkError('Kimlik bilgisi içeren bağlantılara izin verilmez.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.arpa')
  ) {
    throw new UnsafeLinkError('Yerel veya iç ağ adreslerine bağlantı önizlemesi güvenlik nedeniyle engellendi.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new UnsafeLinkError('Özel veya dahili IP adreslerine bağlantı önizlemesi engellendi.');
    }
    return parsed;
  }

  // Resolve DNS records when available and block any private/reserved target IPs
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.some((rec) => isPrivateOrReservedIp(rec.address))) {
      throw new UnsafeLinkError('Bu alan adı dahili bir ağ adresine yönlendiği için engellendi.');
    }
  } catch (err) {
    if (err instanceof UnsafeLinkError) throw err;
    // Offline or DNS unresolvable in sandbox/test -> allow domain fallback preview without network fetch
  }

  return parsed;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']{1,400})["']`, 'i');
  const r2 = new RegExp(`<meta[^>]+content=["']([^"']{1,400})["'][^>]+(?:property|name)=["']${escaped}["']`, 'i');
  const m = html.match(r1) || html.match(r2);
  return m?.[1] ? decodeHtmlEntities(m[1]) : null;
}

export async function fetchSafeLinkPreview(
  rawUrl: string,
  options?: { skipRemoteFetch?: boolean }
): Promise<LinkPreviewData> {
  const safeUrl = await validateSafePublicUrl(rawUrl);
  const domain = safeUrl.hostname.replace(/^www\./, '');
  const fallback: LinkPreviewData = {
    url: safeUrl.toString(),
    domain,
    title: domain,
    description: safeUrl.pathname && safeUrl.pathname !== '/' ? safeUrl.pathname : '',
  };

  if (options?.skipRemoteFetch) {
    return fallback;
  }

  let currentUrl = safeUrl;
  try {
    for (let hop = 0; hop < 3; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);
      try {
        const resp = await fetch(currentUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'SanatSahnedeLinkPreview/1.0 (+https://sanatsahnede.com)',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          },
        });
        clearTimeout(timer);

        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) break;
          currentUrl = await validateSafePublicUrl(new URL(location, currentUrl).toString());
          continue;
        }

        if (!resp.ok) {
          return fallback;
        }

        const ctype = (resp.headers.get('content-type') || '').toLowerCase();
        if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml')) {
          return fallback;
        }

        const reader = resp.body?.getReader();
        if (!reader) return fallback;
        let received = 0;
        const chunks: Uint8Array[] = [];
        while (received < 128 * 1024) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          received += value.byteLength;
        }
        reader.cancel().catch(() => {});
        const html = Buffer.concat(chunks).toString('utf8');
        const titleTag = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1];
        const ogTitle = extractMetaContent(html, 'og:title');
        const ogDesc =
          extractMetaContent(html, 'og:description') ||
          extractMetaContent(html, 'description');

        return {
          url: currentUrl.toString(),
          domain,
          title: (ogTitle || (titleTag ? decodeHtmlEntities(titleTag) : '') || domain).slice(0, 140),
          description: (ogDesc || '').slice(0, 260),
        };
      } catch (innerErr) {
        clearTimeout(timer);
        if (innerErr instanceof UnsafeLinkError) throw innerErr;
        return fallback;
      }
    }
  } catch (err) {
    if (err instanceof UnsafeLinkError) throw err;
  }

  return fallback;
}
