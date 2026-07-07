#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GlpiClient } from './glpi-client.js';
import dotenv from 'dotenv';
import path from 'path';

// Try to load .env from current working directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const server = new McpServer({
  name: 'glpi-mcp-server',
  version: '1.2.5',
});

const GLPI_API_URL = process.env.GLPI_API_URL;
const GLPI_APP_TOKEN = process.env.GLPI_APP_TOKEN;
const GLPI_USER_TOKEN = process.env.GLPI_USER_TOKEN || ''; // Make optional if OAUTH is present
const GLPI_OAUTH_TOKEN = process.env.GLPI_OAUTH_TOKEN;

if (!GLPI_API_URL || !GLPI_APP_TOKEN || (!GLPI_USER_TOKEN && !GLPI_OAUTH_TOKEN)) {
  console.error(
    'Error: Missing required environment variables. Needs GLPI_API_URL, GLPI_APP_TOKEN, and either GLPI_USER_TOKEN or GLPI_OAUTH_TOKEN.'
  );
  process.exit(1);
}

const glpi = new GlpiClient(GLPI_API_URL, GLPI_APP_TOKEN, {
  userToken: GLPI_USER_TOKEN,
  oauthToken: GLPI_OAUTH_TOKEN,
});

// ── Tool: glpi_list_items ──
const listItemsSchema = {
  itemType: z.string().describe('The type of generic object to list (e.g. Computer, Ticket, User)'),
  range: z.string().optional().describe('Range of items to return (e.g. "0-10")'),
  sort: z.string().optional().describe('Field to sort by'),
  order: z.enum(['ASC', 'DESC']).optional().describe('Sort order'),
  is_deleted: z.boolean().optional().describe('Include deleted items'),
  searchText: z
    .string()
    .optional()
    .describe('Filter/search criteria if simple text search is supported by basic list'),
};

// @ts-expect-error — zod + MCP SDK type instantiation too deep for TS
server.tool(
  'glpi_list_items',
  listItemsSchema,
  async ({ itemType, range, sort, order, is_deleted, searchText }) => {
    try {
      const params: Record<string, unknown> = {};
      if (range) params.range = range;
      if (sort) params.sort = sort;
      if (order) params.order = order;
      if (is_deleted !== undefined) params.is_deleted = is_deleted;
      if (searchText) params.searchText = searchText;
      const items = await glpi.listItems(itemType, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: glpi_get_item ──
const getItemSchema = {
  itemType: z.string().describe('The type of item (e.g. Computer, Ticket)'),
  id: z.number().describe('The ID of the item'),
  expand_dropdowns: z
    .boolean()
    .optional()
    .describe('Show details for dropdown fields (params: expand_dropdowns=true)'),
  with_devices: z.boolean().optional().describe('Show associated devices'),
  with_disks: z.boolean().optional().describe('Show associated disks'),
  with_softwares: z.boolean().optional().describe('Show associated softwares'),
  with_connections: z.boolean().optional().describe('Show associated connections'),
  get_hateoas: z.boolean().optional().describe('Show HATEOAS links'),
};

server.tool(
  'glpi_get_item',
  getItemSchema,
  async ({
    itemType,
    id,
    expand_dropdowns,
    with_devices,
    with_disks,
    with_softwares,
    with_connections,
    get_hateoas,
  }) => {
    try {
      const params: Record<string, boolean> = {};
      if (expand_dropdowns) params.expand_dropdowns = true;
      if (with_devices) params.with_devices = true;
      if (with_disks) params.with_disks = true;
      if (with_softwares) params.with_softwares = true;
      if (with_connections) params.with_connections = true;
      if (get_hateoas) params.get_hateoas = true;
      const item = await glpi.getItem(itemType, id, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(item, null, 2) }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: glpi_create_item ──
const createItemSchema = {
  itemType: z.string().describe('The type of item to create'),
  input: z.string().describe('JSON string representing the item fields'),
};

server.tool('glpi_create_item', createItemSchema, async ({ itemType, input }) => {
  try {
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(input);
    } catch {
      throw new Error('Invalid JSON input');
    }
    const result = await glpi.createItem(itemType, parsedInput as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Tool: glpi_update_item ──
const updateItemSchema = {
  itemType: z.string().describe('The type of item to update'),
  id: z.number().describe('The ID of the item to update'),
  input: z.string().describe('JSON string representing the fields to update'),
};

server.tool('glpi_update_item', updateItemSchema, async ({ itemType, id, input }) => {
  try {
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(input);
    } catch {
      return {
        content: [{ type: 'text', text: 'Error: Invalid JSON input' }],
        isError: true,
      };
    }
    const result = await glpi.updateItem(itemType, id, parsedInput as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Tool: glpi_delete_item ──
const deleteItemSchema = {
  itemType: z.string().describe('The type of item to delete'),
  id: z.number().describe('The ID of the item to delete'),
  force: z.boolean().optional().describe('Permanently delete (purge) if true'),
};

server.tool('glpi_delete_item', deleteItemSchema, async ({ itemType, id, force }) => {
  try {
    const result = await glpi.deleteItem(itemType, id, force);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Tool: glpi_search ──
const searchSchema = {
  itemType: z.string().describe('The item type to search (e.g. Computer)'),
  query: z.string().optional().describe('Basic query string'),
  rawParams: z
    .string()
    .optional()
    .describe('JSON string for advanced query parameters directly passed to search endpoint'),
};

server.tool('glpi_search', searchSchema, async ({ itemType, query, rawParams }) => {
  try {
    let criteria: Array<{ link?: string; field: string; searchtype: string; value: string }> = [];
    if (rawParams) {
      try {
        const parsed = JSON.parse(rawParams);
        criteria = parsed.criteria || [];
      } catch {
        return {
          content: [{ type: 'text', text: 'Error: Invalid JSON input for rawParams' }],
          isError: true,
        };
      }
    }

    // GLPI search endpoint has broken criteria filtering.
    // Workaround: fetch ALL items via listItems, then filter client-side.
    const allItems = await glpi.listItems(itemType, { range: '0-500' });
    const items = Array.isArray(allItems) ? allItems : [];

    // Apply criteria filters
    // Map GLPI numeric field IDs to property names (listItems returns named fields)
    const FIELD_MAP: Record<string, string> = {
      '1': 'name', '2': 'id', '12': 'status', '15': 'date', '16': 'closedate',
      '4': 'date_mod', '5': 'date_creation', '7': 'type', '8': 'itilcategories_id',
      '10': 'users_id_recipient', '13': 'urgency', '14': 'impact', '21': 'content',
    };
    function resolveField(item: any, field: string): string {
      // Try direct property first
      if (item && item[field] !== undefined) return String(item[field]);
      // Try mapped name
      const mapped = FIELD_MAP[field];
      if (mapped && item && item[mapped] !== undefined) return String(item[mapped]);
      return '';
    }
    let filtered = items;
    for (const c of criteria) {
      const field = c.field;
      const st = c.searchtype;
      const val = c.value;

      filtered = filtered.filter((item: any) => {
        const itemVal = resolveField(item, field);
        switch (st) {
          case 'equals': return itemVal === val;
          case 'contains': return itemVal.includes(val);
          case 'lessthan': return Number(itemVal) < Number(val);
          case 'morethan': return Number(itemVal) > Number(val);
          case 'notequals': return itemVal !== val;
          default: return true;
        }
      });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalcount: filtered.length,
          count: filtered.length,
          data: filtered,
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Helpers for CIA fields ──

function getPotentialEndpoints(itemType: string): string[] {
  const lower = itemType.toLowerCase();
  const plural = lower.endsWith('s') ? lower : `${lower}s`;
  return [
    `PluginFields${itemType}ciasecurityclassification`,
    `plugin_fields_${plural}`,
    `PluginFields${itemType}`,
    `plugin_fields_${lower}`,
  ];
}

async function findPluginRecord(
  itemType: string,
  itemId: number,
  endpointOverride?: string
): Promise<{ endpoint: string; record: unknown } | null> {
  const endpoints = endpointOverride ? [endpointOverride] : getPotentialEndpoints(itemType);
  for (const endpoint of endpoints) {
    try {
      const params: Record<string, unknown> = {
        'searchText[items_id]': itemId,
      };
      const results = (await glpi.listItems(endpoint, params)) as unknown[];
      if (Array.isArray(results) && results.length > 0) {
        return { endpoint, record: results[0] };
      }
    } catch {
      // Endpoint invalid, try next
    }
  }
  return null;
}

// ── Tool: glpi_get_cia_fields ──
const getCiaFieldsSchema = {
  itemType: z
    .string()
    .describe('The type of item (e.g. Computer, NetworkEquipment, VirtualMachine)'),
  id: z.number().describe('The ID of the item'),
  endpoint_override: z
    .string()
    .optional()
    .describe('Manual override for the plugin endpoint'),
};

server.tool(
  'glpi_get_cia_fields',
  getCiaFieldsSchema,
  async ({ itemType, id, endpoint_override }) => {
    try {
      const result = await findPluginRecord(itemType, id, endpoint_override);
      if (result) {
        return {
          content: [{ type: 'text', text: JSON.stringify(result.record, null, 2) }],
        };
      } else {
        const tried = endpoint_override
          ? [endpoint_override]
          : getPotentialEndpoints(itemType);
        return {
          content: [
            {
              type: 'text',
              text: `No CIA record found for ${itemType} ${id}. Tried endpoints: ${tried.join(', ')}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: glpi_update_cia_fields ──
const updateCiaFieldsSchema = {
  itemType: z.string().describe('The type of item (e.g. Computer)'),
  id: z.number().describe('The ID of the item'),
  confidentialityfield: z.number().optional().describe('Confidentiality Score (1-5)'),
  integrityfield: z.number().optional().describe('Integrity Score (1-5)'),
  availabilityfield: z.number().optional().describe('Availability Score (1-5)'),
  data_sensitivity: z.string().optional().describe('DEPRECATED'),
  critical_asset: z.number().optional().describe('DEPRECATED'),
  max_downtime: z.number().optional().describe('DEPRECATED'),
  other_fields: z.string().optional().describe('JSON string for other fields'),
  endpoint_override: z.string().optional().describe('Manual override for the plugin endpoint'),
};

// @ts-expect-error — zod + MCP SDK type instantiation too deep for TS
server.tool(
  'glpi_update_cia_fields',
  updateCiaFieldsSchema,
  async ({
    itemType,
    id,
    confidentialityfield,
    integrityfield,
    availabilityfield,
    data_sensitivity,
    other_fields,
    endpoint_override,
  }) => {
    const input: Record<string, unknown> = {};

    if (confidentialityfield !== undefined) input.confidentialityfield = confidentialityfield;
    if (integrityfield !== undefined) input.integrityfield = integrityfield;
    if (availabilityfield !== undefined) input.availabilityfield = availabilityfield;

    // Backward compatibility
    if (data_sensitivity && !input.confidentialityfield) {
      const num = parseInt(data_sensitivity);
      if (!isNaN(num)) input.confidentialityfield = num;
    }

    if (other_fields) {
      try {
        const extra = JSON.parse(other_fields);
        Object.assign(input, extra);
      } catch {
        return {
          content: [{ type: 'text', text: 'Error: Invalid JSON for other_fields.' }],
          isError: true,
        };
      }
    }

    if (Object.keys(input).length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: No fields provided to update.' }],
        isError: true,
      };
    }

    try {
      const found = await findPluginRecord(itemType, id, endpoint_override);
      if (found) {
        const result = await glpi.updateItem(
          found.endpoint,
          (found.record as { id: number }).id,
          input
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } else {
        const endpoints = endpoint_override
          ? [endpoint_override]
          : getPotentialEndpoints(itemType);
        let createResult: unknown;
        let createError: Error | undefined;

        for (const endpoint of endpoints) {
          try {
            const payload = { ...input, items_id: id, itemtype: itemType };
            createResult = await glpi.createItem(endpoint, payload);
            break;
          } catch (e) {
            createError = e as Error;
          }
        }

        if (createResult) {
          return {
            content: [{ type: 'text', text: JSON.stringify(createResult, null, 2) }],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to create CIA record. Tried endpoints: ${endpoints.join(', ')}. Last Error: ${createError?.message}`,
              },
            ],
            isError: true,
          };
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: glpi_update_cia_fields_batch ──
const updateCiaFieldsBatchSchema = {
  itemType: z.string().describe('The type of item (e.g. Computer)'),
  ids: z.string().describe('Comma-separated list of IDs to update (e.g. "42,43,44")'),
  confidentialityfield: z.number().optional().describe('Confidentiality Score (1-5)'),
  integrityfield: z.number().optional().describe('Integrity Score (1-5)'),
  availabilityfield: z.number().optional().describe('Availability Score (1-5)'),
  other_fields: z.string().optional().describe('JSON string for other/future fields'),
  endpoint_override: z.string().optional().describe('Manual override for the plugin endpoint'),
};

server.tool(
  'glpi_update_cia_fields_batch',
  updateCiaFieldsBatchSchema,
  async ({
    itemType,
    ids,
    confidentialityfield,
    integrityfield,
    availabilityfield,
    other_fields,
    endpoint_override,
  }) => {
    try {
      const idList = ids
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s)
        .map(Number);

      if (idList.some(isNaN)) {
        return {
          content: [{ type: 'text', text: 'Error: IDs must be valid numbers.' }],
          isError: true,
        };
      }

      const input: Record<string, unknown> = {};
      if (confidentialityfield !== undefined) input.confidentialityfield = confidentialityfield;
      if (integrityfield !== undefined) input.integrityfield = integrityfield;
      if (availabilityfield !== undefined) input.availabilityfield = availabilityfield;

      if (other_fields) {
        try {
          const extra = JSON.parse(other_fields);
          Object.assign(input, extra);
        } catch {
          return {
            content: [{ type: 'text', text: 'Error: Invalid JSON for other_fields.' }],
            isError: true,
          };
        }
      }

      if (Object.keys(input).length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: No fields provided to update.' }],
          isError: true,
        };
      }

      const results: Array<{ id: number; status: string; data?: unknown }> = [];
      const errors: Array<{ id: number; status: string; message: string }> = [];

      for (const id of idList) {
        try {
          const found = await findPluginRecord(itemType, id, endpoint_override);
          let res: unknown;
          if (found) {
            res = await glpi.updateItem(
              found.endpoint,
              (found.record as { id: number }).id,
              input
            );
          } else {
            const endpoints = endpoint_override
              ? [endpoint_override]
              : getPotentialEndpoints(itemType);
            let created = false;
            for (const endpoint of endpoints) {
              try {
                const payload = { ...input, items_id: id, itemtype: itemType };
                res = await glpi.createItem(endpoint, payload);
                created = true;
                break;
              } catch {
                // continue
              }
            }
            if (!created) throw new Error('Could not create record (checked all endpoints)');
          }
          results.push({ id, status: 'success', data: res });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ id, status: 'error', message: msg });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success_count: results.length, error_count: errors.length, results, errors },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GLPI MCP Server running on stdio');
}
