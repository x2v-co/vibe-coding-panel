export function userError(reason: unknown, fallback = '请求未完成'): string {
  const message = reason instanceof Error ? reason.message : '';
  if (/Failed to fetch|fetch failed|NetworkError|Load failed|network request failed/i.test(message)) {
    return '网络连接中断。请检查手机网络，并确认电脑已唤醒、Connector 窗口仍在运行；恢复后先查看任务记录。';
  }
  if (reason instanceof Error && /AbortError|TimeoutError/.test(reason.name)) return '请求超时，请检查连接；发送过的任务先在任务记录中确认状态，避免重复执行。';
  // Our user-facing messages are Chinese. Do not expose HTML, stack traces or
  // raw English transport/runtime errors as recovery instructions.
  if (/[\u3400-\u9fff]/.test(message) && !/<html|Traceback|\n\s+at /i.test(message)) return message.slice(0, 600);
  return `${fallback}，请查看电脑 Connector 的提示后重试。`;
}

export async function readApiResponse(response: Response) {
  let payload;
  try { payload = await response.json(); } catch { /* Proxies can return HTML. */ }
  if (!response.ok) {
    const code = payload && typeof payload === 'object' ? payload.code : undefined;
    const messages: Record<string, string> = {
      CONNECTOR_OFFLINE: '电脑 Connector 未连接。请唤醒电脑并重新打开 Vibe Panel，等待终端显示已连接；通常无需重新配对。',
      CONNECTOR_TIMEOUT: response.url.includes('/transcriptions')
        ? '语音处理超时。请缩短录音，并在电脑确认语音模型已安装；仍可直接输入文字。'
        : '电脑响应超时。请检查 Connector，并先查看任务记录，确认任务是否已启动，避免重复发送。',
      PAIRING_REQUIRED: '设备尚未配对或授权已撤销。请在电脑生成新的配对码，再连接这台设备。',
      RELAY_BUSY: '连接服务暂时繁忙，请稍后重试；已发送的任务请先查看任务记录。',
      BODY_TOO_LARGE: '上传内容过大。请缩短录音或压缩图片，单次文件尽量小于 7 MB。',
    };
    if (code === 'RATE_LIMITED' || response.status === 429) {
      const header = response.headers.get('Retry-After') || '';
      const seconds = /^\d+$/.test(header) ? Math.min(3600, Math.max(1, Number(header))) : null;
      throw new Error(`请求过于频繁，请${seconds ? `等待 ${seconds} 秒后` : '稍后'}重试；无需连续点击连接或重复配对。`);
    }
    if (typeof code === 'string' && Object.hasOwn(messages, code)) throw new Error(messages[code]);
    if (typeof payload?.error === 'string' && /[\u3400-\u9fff]/.test(payload.error)) throw new Error(userError(new Error(payload.error)));
    const byStatus: Record<number, string> = {
      401: messages.PAIRING_REQUIRED,
      403: '访问被拒绝，请检查设备授权或连接服务的访问限制。',
      413: messages.BODY_TOO_LARGE,
      502: '连接服务暂时无法响应，请检查网络和电脑 Connector，稍后再试。',
      503: messages.RELAY_BUSY,
      504: messages.CONNECTOR_TIMEOUT,
    };
    throw new Error(byStatus[response.status] || `请求未完成（HTTP ${response.status}），请检查电脑 Connector 的提示。`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('电脑返回的数据格式无法识别。请刷新网页，并确认网页与 Connector 版本一致。');
  }
  return payload;
}
