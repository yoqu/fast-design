import { describe, expect, it } from 'vitest';
import { reduceTweaksMessage } from './tweaks';

describe('reduceTweaksMessage', () => {
  it('默认开启（省略 visible）时回送 __activate_edit_mode，避免开关「开」却没面板', () => {
    expect(reduceTweaksMessage({ type: '__edit_mode_available' })).toEqual({
      available: true,
      on: true,
      command: '__activate_edit_mode',
    });
  });

  it('显式 visible:true 同样视为默认开启并回送激活指令', () => {
    expect(reduceTweaksMessage({ type: '__edit_mode_available', visible: true })).toEqual({
      available: true,
      on: true,
      command: '__activate_edit_mode',
    });
  });

  it('visible:false 声明默认关闭：开关置关，且不回送任何指令', () => {
    expect(reduceTweaksMessage({ type: '__edit_mode_available', visible: false })).toEqual({
      available: true,
      on: false,
    });
  });

  it('面板本地关闭（×/Esc）时把开关拨回关', () => {
    expect(reduceTweaksMessage({ type: '__edit_mode_dismissed' })).toEqual({ on: false });
  });

  it('非 Tweaks 协议消息一律忽略', () => {
    expect(reduceTweaksMessage({ type: 'od:snapshot:result' })).toBeNull();
    expect(reduceTweaksMessage(null)).toBeNull();
    expect(reduceTweaksMessage('string')).toBeNull();
    expect(reduceTweaksMessage(undefined)).toBeNull();
  });
});
