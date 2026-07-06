import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

interface GlpiClientOptions {
  userToken?: string;
  oauthToken?: string;
  clientId?: string;
  clientSecret?: string;
}

interface GlpiListParams {
  range?: string;
  sort?: string;
  order?: 'ASC' | 'DESC';
  is_deleted?: boolean;
  searchText?: string;
  [key: string]: unknown;
}

interface GlpiGetParams {
  expand_dropdowns?: boolean;
  with_devices?: boolean;
  with_disks?: boolean;
  with_softwares?: boolean;
  with_connections?: boolean;
  get_hateoas?: boolean;
  [key: string]: unknown;
}

interface GlpiSearchParams {
  criteria?: Array<{ link?: string; field: string; searchtype: string; value: string }>;
  metacriteria?: Array<{ link?: string; itemtype: string; searchtype: string; value: string }>;
  sort?: string;
  order?: 'ASC' | 'DESC';
  range?: string;
  forcedisplay?: string[];
  [key: string]: unknown;
}

// Augment InternalAxiosRequestConfig to track retry state
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retriedAuth?: boolean;
  }
}

export class GlpiClient {
  private sessionToken: string | null = null;
  private sessionUrl: string | null = null;
  private appToken: string;
  private userToken?: string;
  private oauthToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private client: AxiosInstance;

  constructor(apiUrl: string, appToken: string, options: GlpiClientOptions) {
    this.appToken = appToken;
    this.userToken = options.userToken;
    this.oauthToken = options.oauthToken;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;

    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'App-Token': this.appToken,
      },
    });

    // GLPI invalidates server-side sessions (PHP GC) while this process keeps the
    // cached session_token forever; re-login once and replay the failed request.
    this.client.interceptors.response.use(undefined, async (error: AxiosError) => {
      const cfg = error.config as InternalAxiosRequestConfig | undefined;
      const data = (error.response?.data as unknown);
      const sessionInvalid =
        error.response?.status === 401 &&
        Array.isArray(data) &&
        (data as string[])[0] === 'ERROR_SESSION_TOKEN_INVALID';

      if (
        sessionInvalid &&
        cfg &&
        !cfg._retriedAuth &&
        !String(cfg.url || '').includes('initSession')
      ) {
        cfg._retriedAuth = true;
        this.sessionToken = null;
        delete this.client.defaults.headers.common['Session-Token'];
        await this.initSession();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cfg.headers as any)['Session-Token'] = this.sessionToken!;
        return this.client.request(cfg);
      }
      return Promise.reject(error);
    });
  }

  // Initialize session (required for most operations)
  async initSession(): Promise<void> {
    if (this.sessionToken) return;

    // Auto-fetch OAuth token if missing but credentials provided
    if (!this.oauthToken && this.clientId && this.clientSecret) {
      try {
        // Deduce root URL for OAuth (removing /apirest.php)
        // If baseURL is http://x/apirest.php, oauth is http://x/plugins/oauth2/index.php/token
        const baseUrl = this.client.defaults.baseURL || '';
        const rootUrl = baseUrl.replace(/\/apirest\.php\/?$/, '');
        const tokenUrl = `${rootUrl}/plugins/oauth2/index.php/token`;

        const tokenRes = await axios.post(
          tokenUrl,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            scope: 'api', // Common scope
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );

        this.oauthToken = tokenRes.data.access_token;
        console.error('[GLPI] Successfully obtained OAuth token via Client Credentials');
      } catch (e: unknown) {
        const detail =
          e instanceof Error
            ? (e as AxiosError).response?.data
              ? JSON.stringify((e as AxiosError).response?.data)
              : e.message
            : String(e);
        console.error(
          `[GLPI] Failed to auto-fetch OAuth token. Ensure 'Client Credentials' grant is enabled in GLPI. Error: ${detail}`
        );
        // Don't throw yet, fallback to user_token might happen (though unlikely if not provided)
      }
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'App-Token': this.appToken,
      };

      // Legacy API (apirest.php) often requires tokens in the BODY for initSession
      // We detect this if the URL contains 'apirest.php' or if simple header auth failed previously
      const isLegacy = this.client.defaults.baseURL?.includes('apirest.php');

      if (isLegacy) {
        // For legacy, we send tokens in body
        const body: Record<string, string> = {};
        if (this.appToken) body.app_token = this.appToken;
        if (this.userToken) body.user_token = this.userToken;
        if (this.oauthToken) headers['Authorization'] = `Bearer ${this.oauthToken}`; // OAuth might still be header

        // If no OAuth, we rely on body tokens
        if (!this.oauthToken && !this.userToken) {
          throw new Error(
            'No valid authentication method found (User Token or OAuth Token required)'
          );
        }

        const response = await this.client.post('/initSession', body, { headers });
        this.sessionToken = response.data.session_token;
      } else {
        // Modern API (Header based)
        // Prefer OAuth Token if available (Using Bearer scheme)
        if (this.oauthToken) {
          headers['Authorization'] = `Bearer ${this.oauthToken}`;
        } else if (this.userToken) {
          // Standard API Token (Using user_token scheme)
          headers['Authorization'] = `user_token ${this.userToken}`;
        } else {
          throw new Error(
            'No valid authentication method found (User Token or OAuth Token required)'
          );
        }

        const response = await this.client.get('/initSession', { headers });
        this.sessionToken = response.data.session_token;
      }

      this.client.defaults.headers.common['Session-Token'] = this.sessionToken;
    } catch (error: unknown) {
      let msg = error instanceof Error ? error.message : String(error);
      if (error instanceof AxiosError && error.response?.data) {
        const data = error.response.data;
        msg = JSON.stringify(data);

        // Detection logic for OAuth plugin interference
        if (
          (data.status === 'ERROR_INVALID_PARAMETER' && data.detail?.includes('JWT')) ||
          (data.status === 'ERROR_UNAUTHENTICATED' && data.detail?.includes('Authorization header'))
        ) {
          msg += `\n[DIAGNOSIS] It appears the GLPI OAuth Plugin is intercepting this request and rejecting the standard API Token.
[ACTION] You must configure the OAuth plugin to allow 'user_token' usage or disable it for the '/apirest.php' path. Alternatively, use OAuth credentials.`;
        }
      }
      throw new Error(`Failed to init session: ${msg}`);
    }
  }

  async killSession(): Promise<void> {
    if (!this.sessionToken) return;
    try {
      await this.client.get('/killSession');
      this.sessionToken = null;
      delete this.client.defaults.headers.common['Session-Token'];
    } catch (error) {
      console.error('Error killing session', error);
    }
  }

  async getItem(itemType: string, id: number, params: GlpiGetParams = {}): Promise<unknown> {
    await this.initSession();
    try {
      const response = await this.client.get(`/${itemType}/${id}`, { params });
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AxiosError && error.response?.data) {
        throw new Error(`${error.message} - Details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async listItems(itemType: string, params: GlpiListParams = {}): Promise<unknown> {
    await this.initSession();
    try {
      const response = await this.client.get(`/${itemType}`, { params });
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AxiosError && error.response?.data) {
        throw new Error(`${error.message} - Details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  async createItem(itemType: string, input: Record<string, unknown>): Promise<unknown> {
    await this.initSession();
    try {
      const response = await this.client.post(`/${itemType}`, { input });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async updateItem(
    itemType: string,
    id: number,
    input: Record<string, unknown>
  ): Promise<unknown> {
    await this.initSession();
    try {
      // GLPI update usually expects an array of input objects or a single object with ID inside input,
      // but typically for standard REST it might be PUT /ItemType/ID
      // GLPI API doc (High-Level) says:
      // PUT /ItemType/:id
      // Body: { "input": { ... fields ... } }
      const response = await this.client.put(`/${itemType}/${id}`, { input });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async deleteItem(itemType: string, id: number, force: boolean = false): Promise<unknown> {
    await this.initSession();
    try {
      const params = force ? { force_purge: true } : {};
      const response = await this.client.delete(`/${itemType}/${id}`, { params });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async search(itemType: string, params: GlpiSearchParams = {}): Promise<unknown> {
    await this.initSession();
    try {
      const response = await this.client.get(`/search/${itemType}`, { params });
      return response.data;
    } catch (error) {
      throw error;
    }
  }
}
