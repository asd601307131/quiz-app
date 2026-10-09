/**
 * 登录页：本地登录 / 微信一键登录（真实后端或演示模式）
 */

import { h, header, toast, confirmDialog } from '../ui/ui.js';
import * as auth from '../services/auth.js';
import { go } from '../app.js';

let pickedAvatar = '🙂';

export function LoginView() {
  const hasBackend = Boolean(auth.API_BASE);

  const nicknameInput = h('input.input', {
    type: 'text',
    maxlength: '20',
    placeholder: '请输入昵称，例如：小明',
    value: auth.isLoggedIn() ? auth.currentUser().nickname : '',
  });

  const avatarPicker = h(
    'div.avatar-picker',
    null,
    auth.AVATAR_PRESETS.map((emoji) =>
      h(
        `button.avatar-option${emoji === pickedAvatar ? '.avatar-option--active' : ''}`,
        {
          type: 'button',
          text: emoji,
          onclick: (e) => {
            pickedAvatar = emoji;
            e.currentTarget.parentElement
              .querySelectorAll('.avatar-option')
              .forEach((n) => n.classList.remove('avatar-option--active'));
            e.currentTarget.classList.add('avatar-option--active');
          },
        }
      )
    )
  );

  const wechatBtn = h('button.btn.btn--primary.btn--block', {
    type: 'button',
    text: hasBackend ? '微信一键登录' : '微信一键登录（演示）',
    onclick: async () => {
      try {
        if (hasBackend) {
          await auth.loginWithWechat();
          return;
        }
        const ok = await confirmDialog({
          title: '演示模式登录',
          text: '当前未连接后端，将以本地演示身份登录（不联网、不获取真实微信信息）。',
          okText: '继续',
        });
        if (!ok) return;
        auth.loginWithWechatDemo({ nickname: nicknameInput.value.trim() || '微信用户' });
        toast('演示登录成功');
        go('profile');
      } catch (err) {
        console.error(err);
        toast(err.message === 'NO_BACKEND' ? '未配置后端，无法发起微信授权' : err.message || '登录失败');
      }
    },
  });

  const localBtn = h('button.btn.btn--outline.btn--block', {
    type: 'button',
    text: '使用昵称登录',
    onclick: () => {
      try {
        auth.loginLocal({ nickname: nicknameInput.value, avatar: pickedAvatar });
        toast('登录成功');
        go('profile');
      } catch (err) {
        toast(err.message || '登录失败');
      }
    },
  });

  const body = h('div.page__body', null, [
    h('div.card', null, [
      h('div.form-field', null, [
        h('label.form-field__label', { text: '昵称' }),
        nicknameInput,
      ]),
      h('div.form-field', null, [
        h('label.form-field__label', { text: '选择头像' }),
        avatarPicker,
      ]),
    ]),
    h('div.mt-16', null, [localBtn]),
    h('div.mt-12', null, [wechatBtn]),
    h('div.card.card--flat.mt-20', null, [
      h('div.list__title', { text: '关于登录' }),
      h('p.text-sm.text-muted.mt-8', {
        text: hasBackend
          ? '已检测到后端服务，微信登录将走标准网页授权流程（snsapi_userinfo）。'
          : '当前为纯前端模式：数据保存在本机浏览器。配置后端后（?api=https://your-host）即可启用真实微信授权登录与云端成绩同步。',
      }),
    ]),
  ]);

  return h('div.page', null, [header({ title: '登录', onBack: () => go('profile') }), body]);
}
