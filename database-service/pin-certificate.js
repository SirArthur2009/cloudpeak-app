import net from 'node:net'
import tls from 'node:tls'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { database } from './settings.js'

const url = new URL(database.DATABASE_URL)
// Bootstrap trust for the newly created Railway endpoint without sending any
// credentials or data. All later DB connections require this certificate.
const socket = net.connect({ host: url.hostname, port: Number(url.port) })
await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]))
const answer = await new Promise((resolve, reject) => { socket.once('data', resolve); socket.once('error', reject) })
if (answer[0] !== 83) throw new Error('Database refused SSL negotiation.')
const secure = tls.connect({ socket, rejectUnauthorized: false })
await new Promise((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject) })
const certificate = secure.getPeerCertificate(true)
const path = new URL('./database-ca.pem', import.meta.url)
if (existsSync(path) && new X509Certificate(readFileSync(path)).fingerprint256 !== certificate.fingerprint256) throw new Error('Database certificate changed; refusing to replace the trust pin.')
const seen = new Set()
let chain = '', current = certificate
while (current?.raw && !seen.has(current.fingerprint256)) {
  seen.add(current.fingerprint256)
  const encoded = current.raw.toString('base64').match(/.{1,64}/g).join('\n')
  chain += `-----BEGIN CERTIFICATE-----\n${encoded}\n-----END CERTIFICATE-----\n`
  current = current.issuerCertificate
}
writeFileSync(path, chain)
secure.end()
console.log(`Pinned the new Railway database TLS certificate: ${certificate.fingerprint256}`)
