# 双人五子棋

## 免输入命令启动
- Windows：双击 `Start-Gomoku-Windows.bat`。
- macOS：双击 `Start-Gomoku-macOS.command`。若 macOS 阻止首次打开，在 Finder 中按住 Control 点击文件，选择“打开”。

首次启动会自动安装项目依赖；需要联网。电脑必须先安装 Node.js LTS。如果未安装，启动器会打开 Node.js 官方下载页。启动后浏览器会打开 `http://localhost:3000`。请保持弹出的命令窗口（Windows）或终端窗口（macOS）开启，关闭它就会停止服务器。

## 手动启动
在此目录运行 `npm install`，然后运行 `npm start`。

同一 Wi-Fi 下，在主机运行服务后，另一台电脑访问 `http://主机局域网IP:3000`。异地游玩需把项目部署到支持持久 WebSocket 的 Node.js 服务，并通过 HTTPS 访问。

等待对手时可选简单、中等或大师机器人；邀请机器人后即可掷骰开局。对局中可点“退出房间”离开。

刷新页面后会自动尝试回到上次的房间，服务器会在无人在线后保留房间 30 分钟。服务器重启仍会清空棋局。悔棋和重新开局需要对方同意。每局开始时两位玩家各掷一次 1–6 点，点数较大者执黑先手；平局重掷。房主没有先手特权。认输立即结束棋局。

## 在线反馈邮件（Render）

反馈表单通过服务器调用 Resend；收件邮箱和 API 密钥不会发送到浏览器。

1. 在 Resend 创建账户，并添加、验证你拥有的发信域名。`FEEDBACK_FROM_EMAIL` 必须使用该已验证域名下的地址，例如 `Gomoku Feedback <feedback@yourdomain.com>`。
2. 在 Resend 创建一个仅有 Sending 权限的 API Key。
3. 在 Render 打开此 Web Service 的 **Environment**，添加以下环境变量：
   - `RESEND_API_KEY`：刚创建的 API Key
   - `FEEDBACK_TO_EMAIL`：接收朋友反馈的私人邮箱
   - `FEEDBACK_FROM_EMAIL`：Resend 已验证域名下的发件地址
4. 将本项目改动部署到 Render。保存环境变量会重启服务；部署完成后，用网页里的“反馈建议”做一次测试。

不要把 API Key 写进源代码、提交到 GitHub 或放进网页。反馈最多 2000 字；同一 IP 每 10 分钟最多提交 5 次。Resend 当前免费额度为每月 3,000 封、每天 100 封，具体以其官方价格页为准。
