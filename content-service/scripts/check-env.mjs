import 'dotenv/config'
import { loadConfig } from '../src/config/env.js'

const config = loadConfig()

console.log(
  `Environment configuration is valid (${config.nodeEnv}, port ${config.port}, SMS mock: ${config.sms.mock})`
)
