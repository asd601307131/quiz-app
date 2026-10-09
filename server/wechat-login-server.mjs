/**
 * 微信网页授权登录后端示例（零依赖）。
 *
 *   WECHAT_APPID=wx... WECHAT_SECRET=... node server/wechat-login-server.mjs
 *   可选：PORT=8787  WEB_ORIGIN=http://localhost:5173
 *
 * 流程：
 *   1. 前端跳转 GET /api/wechat/url?redirect=<页面地址>
 *      -> 302 到微信授权页（snsapi_userinfo）
 *   2. 微信回调 GET /api/wechat/callback?code=...&state=<redirect>
 *      -> 用 code 换 access_token + openid，再拉取用户信息
 *      -> 生成一次性 ticket，302 回前端页面 ?wx_ticket=xxx
 *   3. 前端 GET /api/wechat/profile?ticket=xxx
 *      -> 换取昵称/头像/openid（ticket 一次性，5 分钟过期）
 *
 * 说明：本示例把数据放在内存里，仅用于本地联调；
 *      生产环境请替换为 Redis / 数据库，并做好 state 校验与限流。
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const APPID = process.env.WECHAT_APPID || '';
const SECRET = process.env.WECHAT_SECRET || '';
const PORT = Number(process.env.PORT || 8787);
const WEB_ORIGIN = process.env.WEB_ORIGIN || '*';

/** ticket -> { profile, expireAt } */
const tickets = new Map();
/** state -> { redirect, expireAt }，防止 CSRF */
const states = new Map();

const FIVE_MIN = 5 * 60 * 1000;

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': WEB_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.expireAt < now) tickets.delete(k);
  for (const [k, v] of states) if (v.expireAt < now) states.delete(k);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  sweep();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': WEB_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, wechatConfigured: Boolean(APPID && SECRET) });
    return;
  }

  /* ---- 1. 生成微信授权地址 ---- */
  if (url.pathname === '/api/wechat/url') {
    if (!APPID || !SECRET) {
      sendJson(res, 503, { ok: false, error: '未配置 WECHAT_APPID / WECHAT_SECRET' });
      return;
    }
    const target = url.searchParams.get('redirect') || `${WEB_ORIGIN === '*' ? '' : WEB_ORIGIN}/`;
    const state = randomUUID();
    states.set(state, { redirect: target, expireAt: Date.now() + FIVE_MIN });

    const callback = `http://${req.headers.host}/api/wechat/callback`;
    const authUrl =
      'https://open.weixin.qq.com/connect/oauth2/authorize' +
      `?appid=${encodeURIComponent(APPID)}` +
      `&redirect_uri=${encodeURIComponent(callback)}` +
      '&response_type=code&scope=snsapi_userinfo' +
      `&state=${encodeURIComponent(state)}#wechat_redirect`;

    sendJson(res, 200, { ok: true, url: authUrl });
    return;
  }

  /* ---- 2. 微信回调 ---- */
  if (url.pathname === '/api/wechat/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const saved = states.get(state);
    if (!code || !saved) {
      sendJson(res, 400, { ok: false, error: 'code 或 state 无效' });
      return;
    }
    states.delete(state);

    try {
      const tokenRes = await fetch(
        'https://api.weixin.qq.com/sns/oauth2/access_token' +
          `?appid=${APPID}&secret=${SECRET}&code=${code}&grant_type=authorization_code`
      );
      const token = await tokenRes.json();
      if (!token.access_token || !token.openid) {
        sendJson(res, 400, { ok: false, error: '换取 access_token 失败', detail: token });
        return;
      }

      const infoRes = await fetch(
        'https://api.weixin.qq.com/sns/userinfo' +
          `?access_token=${token.access_token}&openid=${token.openid}&lang=zh_CN`
      );
      const info = await infoRes.json();

      const ticket = randomUUID();
      tickets.set(ticket, {
        expireAt: Date.now() + FIVE_MIN,
        profile: {
          openid: info.openid || token.openid,
          nickname: info.nickname || '微信用户',
          headimgurl: info.headimgurl || '',
          unionid: info.unionid || '',
        },
      });

      const back = new URL(saved.redirect);
      back.searchParams.set('wx_ticket', ticket);
      redirect(res, back.toString());
    } catch (err) {
      sendJson(res, 500, { ok: false, error: '微信接口调用失败', detail: String(err) });
    }
    return;
  }

  /* ---- 3. 前端用 ticket 换用户信息 ---- */
  if (url.pathname === '/api/wechat/profile') {
    const ticket = url.searchParams.get('ticket');
    const saved = ticket && tickets.get(ticket);
    if (!saved) {
      sendJson(res, 404, { ok: false, error: 'ticket 无效或已过期' });
      return;
    }
    tickets.delete(ticket); // 一次性使用
    sendJson(res, 200, saved.profile);
    return;
  }

  sendJson(res, 404, { ok: false, error: '未知接口' });
});

server.listen(PORT, () => {
  console.log(`\n  微信登录后端示例已启动: http://localhost:${PORT}`);
  console.log(`  APPID 配置: ${APPID ? '已配置' : '未配置（/api/wechat/url 会返回 503）'}`);
  console.log(`  前端地址:   ${WEB_ORIGIN}`);
  console.log(`  前端联调:   http://localhost:5173/?api=http://localhost:${PORT}\n`);
});
