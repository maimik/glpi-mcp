import axios, { AxiosError } from 'axios';
export class GlpiClient {
    sessionToken = null;
    sessionUrl = null;
    appToken;
    userToken;
    oauthToken;
    clientId;
    clientSecret;
    client;
    constructor(apiUrl, appToken, options) {
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
        this.client.interceptors.response.use(undefined, async (error) => {
            const cfg = error.config;
            const data = error.response?.data;
            const sessionInvalid = error.response?.status === 401 &&
                Array.isArray(data) &&
                data[0] === 'ERROR_SESSION_TOKEN_INVALID';
            if (sessionInvalid &&
                cfg &&
                !cfg._retriedAuth &&
                !String(cfg.url || '').includes('initSession')) {
                cfg._retriedAuth = true;
                this.sessionToken = null;
                delete this.client.defaults.headers.common['Session-Token'];
                await this.initSession();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cfg.headers['Session-Token'] = this.sessionToken;
                return this.client.request(cfg);
            }
            return Promise.reject(error);
        });
    }
    // Initialize session (required for most operations)
    async initSession() {
        if (this.sessionToken)
            return;
        // Auto-fetch OAuth token if missing but credentials provided
        if (!this.oauthToken && this.clientId && this.clientSecret) {
            try {
                // Deduce root URL for OAuth (removing /apirest.php)
                // If baseURL is http://x/apirest.php, oauth is http://x/plugins/oauth2/index.php/token
                const baseUrl = this.client.defaults.baseURL || '';
                const rootUrl = baseUrl.replace(/\/apirest\.php\/?$/, '');
                const tokenUrl = `${rootUrl}/plugins/oauth2/index.php/token`;
                const tokenRes = await axios.post(tokenUrl, new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    scope: 'api', // Common scope
                }), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                });
                this.oauthToken = tokenRes.data.access_token;
                console.error('[GLPI] Successfully obtained OAuth token via Client Credentials');
            }
            catch (e) {
                const detail = e instanceof Error
                    ? e.response?.data
                        ? JSON.stringify(e.response?.data)
                        : e.message
                    : String(e);
                console.error(`[GLPI] Failed to auto-fetch OAuth token. Ensure 'Client Credentials' grant is enabled in GLPI. Error: ${detail}`);
                // Don't throw yet, fallback to user_token might happen (though unlikely if not provided)
            }
        }
        try {
            const headers = {
                'Content-Type': 'application/json',
                'App-Token': this.appToken,
            };
            // Legacy API (apirest.php) often requires tokens in the BODY for initSession
            // We detect this if the URL contains 'apirest.php' or if simple header auth failed previously
            const isLegacy = this.client.defaults.baseURL?.includes('apirest.php');
            if (isLegacy) {
                // For legacy, we send tokens in body
                const body = {};
                if (this.appToken)
                    body.app_token = this.appToken;
                if (this.userToken)
                    body.user_token = this.userToken;
                if (this.oauthToken)
                    headers['Authorization'] = `Bearer ${this.oauthToken}`; // OAuth might still be header
                // If no OAuth, we rely on body tokens
                if (!this.oauthToken && !this.userToken) {
                    throw new Error('No valid authentication method found (User Token or OAuth Token required)');
                }
                const response = await this.client.post('/initSession', body, { headers });
                this.sessionToken = response.data.session_token;
            }
            else {
                // Modern API (Header based)
                // Prefer OAuth Token if available (Using Bearer scheme)
                if (this.oauthToken) {
                    headers['Authorization'] = `Bearer ${this.oauthToken}`;
                }
                else if (this.userToken) {
                    // Standard API Token (Using user_token scheme)
                    headers['Authorization'] = `user_token ${this.userToken}`;
                }
                else {
                    throw new Error('No valid authentication method found (User Token or OAuth Token required)');
                }
                const response = await this.client.get('/initSession', { headers });
                this.sessionToken = response.data.session_token;
            }
            this.client.defaults.headers.common['Session-Token'] = this.sessionToken;
        }
        catch (error) {
            let msg = error instanceof Error ? error.message : String(error);
            if (error instanceof AxiosError && error.response?.data) {
                const data = error.response.data;
                msg = JSON.stringify(data);
                // Detection logic for OAuth plugin interference
                if ((data.status === 'ERROR_INVALID_PARAMETER' && data.detail?.includes('JWT')) ||
                    (data.status === 'ERROR_UNAUTHENTICATED' && data.detail?.includes('Authorization header'))) {
                    msg += `\n[DIAGNOSIS] It appears the GLPI OAuth Plugin is intercepting this request and rejecting the standard API Token.
[ACTION] You must configure the OAuth plugin to allow 'user_token' usage or disable it for the '/apirest.php' path. Alternatively, use OAuth credentials.`;
                }
            }
            throw new Error(`Failed to init session: ${msg}`);
        }
    }
    async killSession() {
        if (!this.sessionToken)
            return;
        try {
            await this.client.get('/killSession');
            this.sessionToken = null;
            delete this.client.defaults.headers.common['Session-Token'];
        }
        catch (error) {
            console.error('Error killing session', error);
        }
    }
    async getItem(itemType, id, params = {}) {
        await this.initSession();
        try {
            const response = await this.client.get(`/${itemType}/${id}`, { params });
            return response.data;
        }
        catch (error) {
            if (error instanceof AxiosError && error.response?.data) {
                throw new Error(`${error.message} - Details: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
    async listItems(itemType, params = {}) {
        await this.initSession();
        try {
            const response = await this.client.get(`/${itemType}`, { params });
            return response.data;
        }
        catch (error) {
            if (error instanceof AxiosError && error.response?.data) {
                throw new Error(`${error.message} - Details: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
    async createItem(itemType, input) {
        await this.initSession();
        try {
            const response = await this.client.post(`/${itemType}`, { input });
            return response.data;
        }
        catch (error) {
            throw error;
        }
    }
    async updateItem(itemType, id, input) {
        await this.initSession();
        try {
            // GLPI update usually expects an array of input objects or a single object with ID inside input,
            // but typically for standard REST it might be PUT /ItemType/ID
            // GLPI API doc (High-Level) says:
            // PUT /ItemType/:id
            // Body: { "input": { ... fields ... } }
            const response = await this.client.put(`/${itemType}/${id}`, { input });
            return response.data;
        }
        catch (error) {
            throw error;
        }
    }
    async deleteItem(itemType, id, force = false) {
        await this.initSession();
        try {
            const params = force ? { force_purge: true } : {};
            const response = await this.client.delete(`/${itemType}/${id}`, { params });
            return response.data;
        }
        catch (error) {
            throw error;
        }
    }
    async search(itemType, params = {}) {
        await this.initSession();
        try {
            const response = await this.client.get(`/search/${itemType}`, { params });
            return response.data;
        }
        catch (error) {
            throw error;
        }
    }
}
//# sourceMappingURL=glpi-client.js.map