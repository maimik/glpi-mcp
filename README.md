# GLPI MCP Server

A Model Context Protocol (MCP) server for interacting with GLPI (Gestionnaire Libre de Parc Informatique) via its REST API.

This server empowers AI assistants (like Claude) to manage your GLPI inventory, tickets, and specifically **CIA (Confidentiality, Integrity, Availability)** security fields directly.

## Features

- **Core GLPI Operations**:
  - List, Get, Create, Update, Delete items (Computers, Tickets, Users, etc.).
  - Native GLPI Search API support.
- **Advanced CIA Management**:
  - Dedicated tools to view and update Security/CIA fields (`data_sensitivity`, `critical_asset`, `max_downtime`).
  - **Batch Updates**: Update thousands of assets in a single request.
  - **Future-Proof**: Supports custom/future plugin fields via dynamic parameters without code changes.
- **Robust Authentication**:
  - Supports modern header-based auth and legacy body-based auth (`/apirest.php`).
  - Built-in handling for OAuth plugin quirks.

## Installation

```bash
npx -y glpi-mcp
```

## Configuration

You need to provide the following environment variables to authenticate with your GLPI instance:

| Variable           | Description                                                     | Required | Example                        |
| ------------------ | --------------------------------------------------------------- | -------- | ------------------------------ |
| `GLPI_API_URL`     | The full URL to your GLPI API endpoint.                         | Yes      | `http://your-glpi/apirest.php` |
| `GLPI_APP_TOKEN`   | The unique App Token generated in GLPI (Setup > General > API). | Yes      | `j0RHdOk...`                   |
| `GLPI_USER_TOKEN`  | The User Token from your personal settings.                     | Yes\*    | `FOOKqs...`                    |
| `GLPI_OAUTH_TOKEN` | OAuth Access Token (if using OAuth).                            | No\*\*   |                                |

_\* Either `GLPI_USER_TOKEN` or `GLPI_OAUTH_TOKEN` is required._
_\*\* `GLPI_OAUTH_TOKEN` takes precedence if both are provided._

### Claude Desktop Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "glpi": {
      "command": "npx",
      "args": ["-y", "glpi-mcp"],
      "env": {
        "GLPI_API_URL": "https://glpi.example.com/apirest.php",
        "GLPI_APP_TOKEN": "your_app_token_here",
        "GLPI_USER_TOKEN": "your_user_token_here"
      }
    }
  }
}
```

## Available Tools

### 1. Standard Item Management

- `glpi_list_items`: List generic items (Computer, Ticket, User, etc.).
- `glpi_get_item`: Get details of a specific item.
- `glpi_create_item`: Create a new item (e.g., Ticket).
- `glpi_update_item`: Update standard fields of an item.
- `glpi_delete_item`: Delete or purge an item.
- `glpi_search`: Advanced search queries.

### 2. CIA / Security Fields Management 🛡️

Designed for working with the **Generic Object** or **Fields** plugins that add CIA ratings to assets.

#### `glpi_get_cia_fields`

View the current security ratings of an asset.

- **Args**: `itemType` (e.g., "Computer"), `id`.

#### `glpi_update_cia_fields`

Update security ratings for a single asset.

- **Args**:
  - `itemType`, `id`
  - `data_sensitivity` (e.g., "Confidential")
  - `critical_asset` (1 or 0)
  - `max_downtime` (integer)
  - `other_fields` (JSON string): **Important!** Use this to update any new fields you add to GLPI later without updating this server.
    - Example: `'{"new_custom_field": "some_value"}'`

#### `glpi_update_cia_fields_batch`

Update security ratings for **multiple assets** at once. Ideally used by scripts or for bulk policy application.

- **Args**:
  - `itemType`
  - `ids` (Comma-separated string: `"42, 43, 44"`)
  - `data_sensitivity`, `critical_asset`, `max_downtime`
  - `other_fields`

## Examples

### Batch Update Computers

Assign "Confidential" sensitivity to Computers with IDs 100, 101, and 102.

```json
{
  "name": "glpi_update_cia_fields_batch",
  "arguments": {
    "itemType": "Computer",
    "ids": "100, 101, 102",
    "data_sensitivity": "Confidential",
    "critical_asset": 1
  }
}
```

### Future-Proofing with `other_fields`

If you add a new field called `compliance_level` to GLPI tomorrow, you can update it immediately:

```json
{
  "name": "glpi_update_cia_fields",
  "arguments": {
    "itemType": "Computer",
    "id": 50,
    "other_fields": "{\"compliance_level\": \"high\"}"
  }
}
```

## Troubleshooting

- **2FA/OTP Error on Publish**: If you are trying to publish this package yourself and see OTP errors, use the provided helper script: `./publish_with_otp.sh`.
- **403 Forbidden**: Verify your `GLPI_APP_TOKEN` and `GLPI_USER_TOKEN`. Ensure the user has write access to the specific assets.
- **Authorization Header Missing**: Typical with the GLPI OAuth plugin. Ensure you are using the `/apirest.php` endpoint in your URL, or configure the plugin to accept `user_token`.

## License

ISC
