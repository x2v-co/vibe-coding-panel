import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Read-only diagnostics. Never start an agent, request permissions or print auth output.
export function checkController({target,env=process.env,platform=process.platform,node=process.versions.node,exists=existsSync,run=spawnSync}={}) {
  const rows=[];
  const add=(name,ready,detail)=>rows.push({name,ready,detail});
  const [major,minor]=node.split('.').map(Number);
  add('Node.js',major>22 || (major===22&&minor>=12),`当前 ${node}；需要 22.12 或更新版本`);
  if(target==='claude-code') {
    const bin=env.PANEL_CLAUDE_BIN || 'claude';
    const version=run(bin,['--version'],{env,timeout:5000,encoding:'utf8'});
    const installed=!version.error&&version.status===0;
    add('Claude Code',installed,installed?'已安装':'请安装 Claude Code，并确保终端可以运行 claude');
    if(installed) {
      const auth=run(bin,['auth','status'],{env,timeout:10000,encoding:'utf8'});
      let loggedIn=false;try{loggedIn=!auth.error&&auth.status===0&&JSON.parse(auth.stdout).loggedIn===true;}catch{}
      add('Claude Code 登录',loggedIn,loggedIn?'已登录':'请在电脑终端运行 claude auth login 后重试');
    }
  } else {
    add('操作系统',platform==='darwin','Codex App / Claude App 外设需要 macOS；其他系统可选择 Claude Code');
    if(platform==='darwin') {
      const swift=run('/usr/bin/xcrun',['--find','swift'],{timeout:5000,encoding:'utf8'});
      add('桌面控制工具',!swift.error&&swift.status===0,'需要 Apple 命令行工具；缺失时运行 xcode-select --install');
      const app=target==='claude-app'?'Claude.app':'Codex.app';
      const bundle=target==='claude-app'?'com.anthropic.claudefordesktop':'com.openai.codex';
      const found=run('/usr/bin/mdfind',[`kMDItemCFBundleIdentifier == "${bundle}"`],{timeout:5000,encoding:'utf8'});
      const indexed=!found.error&&found.status===0&&String(found.stdout||'').split('\n').some(value=>value.endsWith('.app')&&exists(value));
      const installed=indexed||exists(path.join('/Applications',app))||exists(path.join(homedir(),'Applications',app));
      add('目标 App',installed,installed?'已找到目标应用（按应用标识检测）':`未找到 ${app}；请安装或确认安装位置`);
      add('辅助功能权限',null,'绑定时验证；系统设置 → 隐私与安全性 → 辅助功能，允许启动外设服务的终端或宿主应用');
    }
  }
  add('手机麦克风',null,'手机须打开 HTTPS 入口并允许麦克风；首次录音时验证');
  add('语音识别与纠错',null,'启动服务后用一段录音验证；不因启动成功就视为语音服务就绪');
  return rows;
}
