import { writeFileSync } from 'node:fs'
const [settingsFile, repository] = process.argv.slice(2)
if (!settingsFile || !repository) throw new Error('Provide settings path and local Maven repository')
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || ''
let proxy = ''
if (proxyUrl) {
  const address = new URL(proxyUrl)
  if (address.username || address.password) throw new Error('Authenticated proxy requires supported external Maven configuration')
  proxy = `<proxies><proxy><id>cloud</id><active>true</active><protocol>http</protocol><host>${escape(address.hostname)}</host><port>${address.port || 80}</port><nonProxyHosts>localhost|127.0.0.1</nonProxyHosts></proxy></proxies>`
}
writeFileSync(settingsFile, `<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"><localRepository>${escape(repository)}</localRepository>${proxy}</settings>`, { mode: 0o600 })
