import { microActions, microDirections, microStatusLegend, unavailableMicroAction } from './micro';
import type { MicroActionId, MicroBinding, MicroPreferences } from './micro';

export function MicroActionOptions({toggleVoice=false}:{toggleVoice?:boolean}) {
  return <>{[false,true].map(unavailable=><optgroup key={String(unavailable)} label={unavailable?'桌面功能 · 当前不可用':'Panel 可用操作'}>{microActions.filter(a=>Boolean(unavailableMicroAction(a.id))===unavailable).map(a=><option key={a.id} value={a.id} disabled={unavailable}>{toggleVoice&&a.id==='voice'?'语音输入（再次触发结束录音）':a.label}</option>)}</optgroup>)}</>;
}
function BindingEditor({label,value,onChange}:{label:string;value:MicroBinding;onChange:(v:MicroBinding)=>void}) {
  return <div className="micro-binding-editor"><label>{label}<select aria-label={label} value={value.action} onChange={e=>onChange({...value,action:e.target.value as MicroActionId})}><MicroActionOptions toggleVoice /></select></label>{value.action==='prompt'&&<textarea aria-label={`${label}快捷指令`} rows={2} maxLength={1000} value={value.prompt} onChange={e=>onChange({...value,prompt:e.target.value})} placeholder="填入输入框，手动发送"/>}</div>;
}
export function MicroSettings({value,onChange,tasks}:{value:MicroPreferences;onChange:(v:MicroPreferences)=>void;tasks:{id:string;prompt:string}[]}) {
  return <div className="micro-behavior-settings">
    <details><summary>状态灯与操作说明</summary>
      <p>所选任务的状态灯会脉动。下方命令键的键帽配色是外观设置，不代表任务状态。</p>
      <ul className="micro-status-legend">{microStatusLegend.map(s=><li key={s.id}><i className={`legend-${s.id}`}/><span><strong>{s.color} · {s.label}</strong><small>{s.description}</small></span></li>)}</ul>
      <p>语音：按住说话，松开结束；350 毫秒内双击可持续录音，再按一次结束。青绿色表示录音，白色闪动表示转写，常亮白色表示草稿就绪。使用当前手机或电脑的麦克风。</p>
      <p>网页中单击任务键直接切换任务。双击聚焦桌面 App、蓝牙通道、硬件灯光亮度和电池状态属于实体设备功能。</p>
      <a href="https://learn.chatgpt.com/zh-Hans/docs/features/codex-micro" target="_blank" rel="noreferrer">官方 Codex Micro 指南</a>
    </details>
    <details><summary>Agent 键 · 任务分配</summary>
      <label>排列方式<select aria-label="Agent 键排列方式" value={value.agentMode} onChange={e=>onChange({...value,agentMode:e.target.value as MicroPreferences['agentMode']})}><option value="recent">最近更新的六个任务</option><option value="priority">优先：未读完成、执行中、其他</option><option value="pinned">固定的任务</option><option value="custom">自定义任务分配</option></select></label>
      <p>按空槽新建任务；自定义模式会将随后创建的任务分配给该槽。审批状态和技能分配暂不可用。</p>
      {value.agentMode==='pinned'&&<div className="micro-pin-list">{tasks.length?tasks.map(t=><label key={t.id}><input type="checkbox" checked={value.pinned.includes(t.id)} disabled={!value.pinned.includes(t.id)&&value.pinned.length>=6} onChange={e=>onChange({...value,pinned:e.target.checked?[...value.pinned,t.id]:value.pinned.filter(id=>id!==t.id)})}/>{t.prompt}</label>):<p>暂无可固定任务</p>}</div>}
      {value.agentMode==='custom'&&value.assignments.map((id,i)=><label key={i}>任务槽 {i+1}<select aria-label={`分配任务槽 ${i+1}`} value={id} onChange={e=>onChange({...value,assignments:value.assignments.map((old,n)=>n===i?e.target.value:old)})}><option value="">空槽 · 新建任务</option>{id&&!tasks.some(t=>t.id===id)&&<option value={id}>任务已不可用</option>}{tasks.map(t=><option key={t.id} value={t.id}>{t.prompt}</option>)}</select></label>)}
    </details>
    <details><summary>模拟摇杆 · 四个方向</summary><p>拖离中心触发一次，松手回中；也可点方向箭头或使用键盘方向键。</p>{microDirections.map(({id,label})=><BindingEditor key={id} label={`摇杆向${label}`} value={value.joystick[id]} onChange={v=>onChange({...value,joystick:{...value.joystick,[id]:v}})}/>)}</details>
    <details><summary>旋钮 · 模式与操作</summary>
      <label>旋钮模式<select aria-label="旋钮模式" value={value.knobMode} onChange={e=>onChange({...value,knobMode:e.target.value as MicroPreferences['knobMode']})}><option value="composer">编辑器导航</option><option value="reasoning" disabled>仅推理（当前不可用）</option><option value="scroll">对话滚动</option><option value="custom">自定义分配</option></select></label>
      <p>上下拖动或滚轮转动，点左右箭头也可逐项移动。按下选择，长按打开设置；自定义模式使用所分配的长按操作。</p>
      {value.knobMode==='composer'&&<p>转动高亮可用输入控件，按下选择；旋钮旁的任务键亮红时，按它取消选择。弹窗打开后可用弹窗关闭按钮或 Esc 返回。</p>}
      {value.knobMode==='scroll'&&<p>转动滚动当前消息区，按下跳至最新内容。</p>}
      {value.knobMode==='custom'&&(['left','right','press','hold'] as const).map((id,i)=><BindingEditor key={id} label={['旋钮左转','旋钮右转','旋钮按下','旋钮长按'][i]} value={value.knob[id]} onChange={v=>onChange({...value,knob:{...value.knob,[id]:v}})}/>)}
    </details>
  </div>;
}
