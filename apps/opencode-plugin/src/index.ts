import type { Plugin } from '@opencode-ai/plugin'
import { correctTool } from './tools/correct.js'
import { slogLogTool } from './tools/log.js'
import { slogFindTool, slogListTool } from './tools/read.js'

const AgentToolsPlugin: Plugin = async () => {
  return {
    tool: {
      slog_correct: correctTool,
      slog_find: slogFindTool,
      slog_list: slogListTool,
      slog_log: slogLogTool,
    },
  }
}

export default AgentToolsPlugin
