# GBP MCP Server (Google Business Profile)

A Model Context Protocol (MCP) server covering the full Google Business Profile surface: reviews, posts, Q&A, media, insights, and attributes.

> Forked from [satheeshds/gbp-review-agent](https://github.com/satheeshds/gbp-review-agent) (reviews only) and extended. See [CHANGES.md](CHANGES.md) for the diff.

## Features

**28 MCP tools across 6 surfaces.** Mock mode lets you develop against the full tool surface today; live mode requires [GBP API access approval](https://developers.google.com/my-business/content/prereqs) (60+ day waitlist).

- **Reviews** (5 tools) — `list_locations`, `get_unreplied_reviews`, `generate_reply` (direct Anthropic-compatible HTTP call, MCP sampling, or template — see note below), `post_reply`, `delete_review_reply`, `get_review_day_stats`
- **Local Posts** (4 tools) — `get_local_posts`, `create_local_post`, `update_local_post`, `delete_local_post` (STANDARD / EVENT / OFFER / ALERT)
- **Q&A** (4 tools) — `get_questions`, `upsert_answer`, `delete_answer`, `delete_question` *(beyond InsightfulPipe parity)*
- **Media** (4 tools) — `get_media`, `create_media`, `start_media_upload`, `delete_media`
- **Insights** (3 tools) — `get_daily_metrics`, `get_multi_daily_metrics`, `get_search_keywords` (Business Profile Performance API)
- **Business Info** (7 tools) — `get_location_details`, `get_location_attributes`, `get_available_attributes`, `get_services`, `get_categories`, `get_batch_categories`, `get_verifications`
- **OAuth Integration** ✅ — auth across all 7 GBP sub-API hosts (legacy v4, BUSINESS_INFO, QANDA, PERFORMANCE, VERIFICATIONS, ACCOUNT_MGMT, LODGING)
- **Mock Mode** ✅ — every tool has a mock-mode fallback returning realistic placeholder data

Compared to [InsightfulPipe's hosted MCP](https://insightfulpipe.com/mcp-servers/google-my-business) (24 actions): full parity on reviews/posts/media/insights/business info, plus 4 Q&A tools they don't expose. Skipped: food menus (lodging-specific). Self-hosted, no SaaS, you own your OAuth tokens.

## Prerequisites

- Node.js 18.0.0 or higher
- Google Cloud Platform account with My Business API enabled
- Google OAuth 2.0 credentials
- **Google Business Profile API Access** (see requirements below)

### Google Business Profile API Access Requirements

Before you can use this MCP server, you must request and be approved for Google Business Profile API access. Google requires all applicants to:

1. **Manage a verified Google Business Profile** that has been active for 60+ days
   - This can be your own business or a client's business you manage
2. **Have a website** representing the business listed on the Google Business Profile
3. **Complete Google Business Profile** with current, up-to-date information

**To request API access:**

1. Go to the [Google Cloud Console](https://console.developers.google.com/project) and note your Project Number from the Project info card
2. Submit your request using the [GBP API contact form](https://support.google.com/business/contact/api_default)
   - Select "Application for Basic API Access" from the dropdown
   - Provide your Project Number and all requested information
   - Use an email address listed as an owner/manager on your business's GBP
3. Wait for review - you'll receive a follow-up email with the decision

**Check approval status** by viewing quotas in Google Cloud Console:
- **0 QPM (Queries Per Minute)** = Not yet approved
- **300 QPM** = Approved ✓

For complete prerequisites, see the [official GBP API documentation](https://developers.google.com/my-business/content/prereqs).

## Setup

### 1. Google Cloud Configuration

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. **Request GBP API access** (see requirements above - this step is critical and may take time for approval)
4. **Enable the following APIs** (after your project is approved):
   - Go to "APIs & Services" > "Library"
   - Search for and enable **"Google My Business API"**
   - Search for and enable **"My Business Account Management API"**
   - Each GBP API is enabled **separately per project** — enabling one (e.g. `mybusiness.googleapis.com`)
     does not enable the others (`mybusinessbusinessinformation.googleapis.com`,
     `mybusinessqanda.googleapis.com`, `mybusinessverifications.googleapis.com`,
     `businessprofileperformance.googleapis.com`, `mybusinesslodging.googleapis.com`). If a tool that
     talks to one of these hosts fails, check "APIs & Services" > "Library" for that specific API and
     enable it — see [Troubleshooting](#each-gbp-api-must-be-enabled-separately) below.
5. Create OAuth 2.0 credentials:
   - Go to "Credentials" in the API & Services section
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Set application type to "Web application"
   - Add authorized redirect URI: `http://localhost:3000/auth/callback`
   - Note down the Client ID and Client Secret
6. **Configure OAuth Consent Screen**:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Add test users (your Google account email that has access to the business profile)
   - Add required scopes: `business.manage`, `userinfo.email`, `userinfo.profile`

### 2. Installation

```bash
# Clone the repository
git clone <repository-url>
cd review-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### 3. Configuration

```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your credentials
# Add your Google OAuth credentials and other settings
```

Required environment variables:
- `GOOGLE_CLIENT_ID`: Your Google OAuth 2.0 Client ID
- `GOOGLE_CLIENT_SECRET`: Your Google OAuth 2.0 Client Secret
- `GOOGLE_REDIRECT_URI`: OAuth redirect URI (default: http://localhost:3000/auth/callback)

Optional — enables the direct HTTP path for `generate_reply` (see [Available Tools](#available-tools)):
- `ANTHROPIC_API_KEY`: API key for an Anthropic-compatible `/v1/messages` endpoint
- `ANTHROPIC_BASE_URL`: Base URL for that endpoint (defaults to `https://api.anthropic.com`; any Anthropic-compatible host works)
- `GBP_REPLY_MODEL`: Model name to request (defaults to `claude-haiku-4-5-20251001`)

### 4. Authentication

Before running the server, you need to authenticate with Google:

```bash
# Run the authentication helper
npm run auth
```

This will:
1. Open your browser to Google's authentication page
2. Ask you to grant permissions to access your Google Business Profile
3. Save the authentication tokens locally
4. These tokens will be automatically used by the MCP server

### 5. Running the Server

```bash
# Start the server with your authenticated credentials
npm start

# Or in development/mock mode for testing
npm run start:mock
```

The server will start with STDIO transport for MCP communication.

## Usage

### Connecting to MCP Clients

You can connect to this server using any MCP-compatible client:

#### VS Code (GitHub Copilot)

Add to your VS Code MCP settings file (`mcp.json`):

**Windows:** `%APPDATA%\Code\User\profiles\<profile-id>\mcp.json`  
**macOS/Linux:** `~/.config/Code/User/profiles/<profile-id>/mcp.json`

```jsonc
{
  "servers": {
    "google-business-reviews": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\path\\to\\review-mcp\\build\\index.js"
      ],
      "cwd": "C:\\path\\to\\review-mcp",
      "env": {
        "NODE_ENV": "production",
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3000/auth/callback",
        "LOG_LEVEL": "info"
      },
      "description": "Google Business Profile Review MCP Server - Manage reviews with AI-powered responses"
    }
  }
}
```

**Important Notes:**
- Replace `C:\\path\\to\\review-mcp` with the actual path to your project
- Use double backslashes (`\\`) in Windows paths
- Replace `your-client-id` and `your-client-secret` with your actual OAuth credentials
- Make sure to run `npm run auth` first to authenticate before using in VS Code
- Restart VS Code after adding the configuration

#### Claude Desktop

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "google-business-reviews": {
      "command": "node",
      "args": ["/path/to/review-mcp/build/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3000/auth/callback"
      }
    }
  }
}
```

#### HTTP Clients
Connect to: `http://localhost:3000/mcp`

### Available Tools

1. **`list_locations`**: Get all business locations associated with your account
2. **`get_reviews`**: Fetch reviews for a specific location
3. **`generate_reply`**: Generate a response to a review. Tries each of the following in order and uses the first one available:
   1. **Direct HTTP call** to an Anthropic-compatible `/v1/messages` endpoint, if `ANTHROPIC_API_KEY` is set (see [Configuration](#3-configuration) above). Aborts after ~15s and falls through to the template rather than risk a slow response.
   2. A registered in-process sampling callback, if one has been set programmatically.
   3. [MCP sampling](https://modelcontextprotocol.io/docs/concepts/sampling), which requires client support and does **not** work over the remote HTTP transport (e.g. the claude.ai remote connector) — it will hang until the request times out.
   4. A static template response, which always succeeds.

   In practice: configure `ANTHROPIC_API_KEY` for AI-generated replies in any deployment, including remote HTTP transports where sampling can't work. Without it, replies fall back to templates unless the connecting client implements MCP sampling. See [AI_REPLY_GENERATION.md](AI_REPLY_GENERATION.md) for background.
4. **`post_reply`**: Post a reply to a review on Google Business Profile

### Available Resources

1. **`business_profile`**: Business profile information and settings
2. **`review_templates`**: Pre-defined response templates

### Available Prompts

1. **`review_response`**: Generate professional review responses
2. **`sentiment_analysis`**: Analyze review sentiment

## Development

### Project Structure

```
src/
├── index.ts              # Main server entry point
├── server/               # MCP server implementation
│   ├── mcpServer.ts     # Core MCP server setup
│   ├── tools/           # Tool implementations
│   ├── resources/       # Resource implementations
│   └── prompts/         # Prompt implementations
├── services/            # Business logic services
│   ├── googleAuth.ts    # Google OAuth handling
│   ├── reviewService.ts # Review management
│   └── llmService.ts    # LLM interaction
├── types/               # TypeScript type definitions
└── utils/               # Utility functions
```

### Scripts

- `npm run dev`: Start development server with hot reload
- `npm run build`: Build the TypeScript project
- `npm run lint`: Run ESLint
- `npm run test`: Run tests
- `npm run clean`: Clean build directory

## API Documentation

### Authentication Flow

1. User initiates OAuth flow through the MCP client
2. Server redirects to Google OAuth consent screen
3. User grants permissions for Google My Business access
4. Server receives authorization code and exchanges for access token
5. Token is stored securely for subsequent API calls

### Rate Limiting

The server implements rate limiting to respect Google API quotas:
- 60 requests per minute per user (configurable)
- Exponential backoff for failed requests
- Graceful error handling for quota exceeded

## Security Considerations

- All Google API calls use OAuth 2.0 authentication
- Access tokens are stored securely and refreshed automatically
- Input validation and sanitization for all user inputs
- Rate limiting to prevent abuse
- Comprehensive logging for security monitoring

## Troubleshooting

### Common Issues

1. **OAuth Error**: Ensure redirect URI matches exactly what's configured in Google Cloud Console
2. **API Quota Exceeded**: Check your Google Cloud Console for API usage and limits
3. **Permission Denied**: Verify the Google account has access to the business profile

### Each GBP API must be enabled separately

Google Business Profile isn't one API — it's a family of separate services, each with its own host
and its own "Enable" toggle in Cloud Console:

- `mybusiness.googleapis.com` (reviews, posts, media — legacy v4)
- `mybusinessaccountmanagement.googleapis.com` (accounts)
- `mybusinessbusinessinformation.googleapis.com` (locations, attributes, categories, services)
- `mybusinessqanda.googleapis.com` (questions and answers)
- `businessprofileperformance.googleapis.com` (daily metrics, search keywords)
- `mybusinessverifications.googleapis.com` (verification attempts)
- `mybusinesslodging.googleapis.com` (food/dining menus)

Enabling one of these does **not** enable the others. It's easy to enable the ones your first
feature needs, confirm those tools work, and then hit a hard failure the moment you try a tool that
talks to a different host — reviews and location lookups can be working fine while Q&A or
verifications are still disabled. If a tool call fails outright (a `SERVICE_DISABLED` 403, or a
non-JSON/HTML error body — see below), check "APIs & Services" > "Library" for the specific host
that tool uses and enable it there.

### GBP API enabled but not yet allowlisted

If you've enabled the GBP APIs in a GCP project but access hasn't been approved yet (see
[Google Business Profile API Access Requirements](#google-business-profile-api-access-requirements)),
calls like `list_locations` will **fail fast with a `GBP API access not provisioned for project
<project>`** error instead of hanging.

This state is easy to misdiagnose because:

- It presents as an HTTP 429 (`RESOURCE_EXHAUSTED`), which looks like a rate limit rather than a
  permanent denial. The server distinguishes the two by checking whether the error's
  `quota_limit_value` is `"0"` — the pre-approval default — versus a nonzero value, which is a
  genuine rate limit and is retried as normal.
- It is **invisible in the GCP console**: the GBP APIs show as "Enabled" with no warning that
  access hasn't been granted. The only place the zero quota shows up is the quota page for the
  specific method (e.g. `mybusinessaccountmanagement.googleapis.com`), and even there it's easy to
  miss among unrelated quotas.

If you see this error, submit (or check the status of) your request via the
[GBP API contact form](https://support.google.com/business/contact/api_default) — see
[Google Business Profile API Access Requirements](#google-business-profile-api-access-requirements)
above. The full underlying error is available at `LOG_LEVEL=debug` if you need it for support
correspondence.

### Logging

Enable debug logging by setting `LOG_LEVEL=debug` in your `.env` file.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the logs with debug level enabled
3. Open an issue on GitHub with detailed information about the problem