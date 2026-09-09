export function speechFailure(reason) {
  const text = String(reason?.message || reason || '');
  let code = 'SPEECH_FAILED', message = '语音转写未完成。请在电脑运行 Setup Voice 并重启 Connector；仍可直接输入文字。';
  if (reason?.code === 'ENOENT') { code = 'WHISPER_MISSING'; message = '未找到 Whisper。请在电脑安装包中运行 Setup Voice，完成后重启 Connector；仍可直接输入文字。'; }
  else if (reason?.code === 'EACCES' || /permission denied/i.test(text)) { code = 'SPEECH_PERMISSION'; message = '语音程序或模型目录无法访问。请检查电脑上的文件权限，或将语音安装到当前用户可写的目录后重试。'; }
  else if (/timeout|timed out|超时/i.test(text)) { code = 'SPEECH_TIMEOUT'; message = '语音转写超时。请缩短录音，确认电脑上的模型已准备好后重试；仍可直接输入文字。'; }
  else if (/out of memory|cannot allocate memory|not enough memory/i.test(text)) { code = 'SPEECH_MEMORY'; message = '电脑内存不足，无法加载语音模型。请关闭占用内存的程序，或使用更小的语音模型；仍可输入文字。'; }
  else if (/certificate|SSL|URLError|HTTP Error|checksum|download|connection|network/i.test(text)) { code = 'SPEECH_MODEL_DOWNLOAD'; message = '语音模型下载或校验失败。请检查电脑网络，在电脑运行 Setup Voice 完成模型准备后重试。'; }
  else if (/No module named|ImportError|ModuleNotFoundError|DLL load|Library not loaded|numpy|torch|numba/i.test(text)) { code = 'SPEECH_DEPENDENCIES'; message = '电脑上的语音依赖不完整或不兼容。请重新运行 Setup Voice；使用自定义 MLX 环境时请修复对应 Python 环境后重启 Connector。'; }
  else if (/invalid choice|unrecognized arguments|not one of available models|model.*not found/i.test(text)) { code = 'SPEECH_CONFIGURATION'; message = '语音模型或启动参数与当前程序不兼容。请检查电脑设置中的语音后端和模型，或恢复默认语音安装后重试。'; }
  return Object.assign(new Error(message), { code, status: code === 'SPEECH_TIMEOUT' ? 504 : 503 });
}

export function agentFailure(reason, provider = 'codex') {
  const label = provider === 'claude' ? 'Claude Code' : 'Codex';
  const text = String(reason?.message || reason || '');
  if (reason?.code === 'ENOENT') return `无法启动 ${label}。请确认电脑已安装该 Agent，启动路径和工作目录有效，再重启 Connector。`;
  if (reason?.code === 'EACCES' || /permission denied/i.test(text)) return `${label} 无法访问程序或工作目录。请检查电脑上的执行权限与项目权限。`;
  if (/authorization|unauthorized|authentication|invalid.?api.?key|not logged in|login required|模型服务拒绝/i.test(text)) return `模型服务拒绝了 ${label} 的认证。请在电脑检查 Agent 登录及所选模型服务商的密钥配置；手机配对无需重做。`;
  if (/rate.?limit|quota|usage.?limit|insufficient.*(credit|balance)|credit balance|限额|额度/i.test(text)) return `${label} 的模型服务额度不足或请求受限。请查看服务商的额度和恢复时间，稍后再试；重新配对无法解决。`;
  if (/ENOTFOUND|ECONNREFUSED|network|connection|timed out|stream disconnected/i.test(text)) return `${label} 与模型服务的连接中断。请检查电脑网络和服务商地址，先查看任务记录及项目改动，再决定是否继续任务。`;
  if (/unknown option|unrecognized argument|unexpected argument|unsupported/i.test(text)) return `${label} 当前版本不支持所需启动参数。请检查版本与安装说明，更新兼容的 CLI 后重启 Connector。`;
  return `${label} 未能完成任务。请查看任务记录中的日志及电脑上的 Agent 提示，确认项目改动后再重试。`;
}
