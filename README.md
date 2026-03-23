# BurnData - Redact.dev Alternative

Mass delete your social media data from Discord, Twitter, Reddit and more.

## Features

- **Discord** - Delete messages, DMs, and server content
- **Twitter/X** - Delete tweets, likes, and retweets (coming soon)
- **Reddit** - Delete posts and comments (coming soon)
- **More platforms** - Telegram, Facebook, Instagram...

## Why BurnData?

- **Free & Open Source** - No subscription fees
- **Privacy First** - Your tokens never leave your device
- **Desktop + Web** - Use the app or the web version
- **Export Before Delete** - Backup your data before removal

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+

### Installation

```bash
# Clone the repo
git clone https://github.com/NobodyHeree/BurnData.git
cd BurnData

# Install dependencies
pnpm install

# Run desktop app
pnpm dev

# Or run web version
pnpm dev:web
```

## Project Structure

```
burndata/
├── apps/
│   ├── desktop/      # Electron + React app
│   ├── cli/          # Headless CLI for servers
│   └── web/          # Web version
├── packages/
│   ├── ui/           # Shared React components
│   ├── core/         # Business logic
│   └── services/     # Platform APIs (Discord, Twitter, etc.)
└── package.json
```

## How It Works

### Discord
1. Enter your Discord user token (tutorial included)
2. Select servers/DMs to clean
3. Apply filters (date, keywords, etc.)
4. Preview & confirm deletion
5. Watch real-time progress

### Getting Your Discord Token
> **Warning**: Using a user token is against Discord's Terms of Service. Use at your own risk.

1. Open Discord in your browser
2. Press F12 → Network tab
3. Send a message and look for the request
4. Copy the `Authorization` header value

## Tech Stack

- **Desktop**: Electron + React + Vite
- **Web**: React + Vite
- **CLI**: Node.js + TypeScript (headless, for servers)
- **Shared**: TypeScript, Tailwind CSS
- **State**: Zustand
- **API**: REST + WebSocket for real-time updates

## Disclaimer

This tool is for educational purposes. Using user tokens may violate platform Terms of Service. The authors are not responsible for any account bans or data loss.

## License

MIT
