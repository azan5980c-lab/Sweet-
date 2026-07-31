# Telegram Web App — Verification + Bot Submission

This project is a mobile-first Telegram Web App that:
- Collects username and phone.
- Requests a server-issued verification code.
- Verifies the code server-side.
- Submits the approved application to your Telegram bot (server-side).

Project structure:
project/
├── package.json
├── server.js
├── .gitignore
├── README.md
└── public/
    ├── index.html
    ├── style.css
    └── app.js

Environment variables (set in Render):
- BOT_TOKEN (required to send messages via Telegram Bot API)
- BOT_CHAT_ID (required: numeric chat_id where bot sends notifications)
- SHOW_DEBUG_CODE (optional; "true" to have server return debug verification code for testing)

Endpoints:
- GET /health -> { "status": "ok" }
- POST /api/request-code -> start verification (body: { username, phone })
- POST /api/verify-code -> verify entered code (body: { username, phone, verificationCode })
- POST /api/submit -> final submission (body: { username, phone, verificationCode })

Security notes:
- Never put BOT_TOKEN in client code.
- All bot interactions happen on the server.
- Use HTTPS (Render provides it).

See the README section in this file for deployment and testing steps.
