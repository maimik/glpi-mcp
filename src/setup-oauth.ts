import axios from 'axios';
import http from 'http';
import readline from 'readline';
import { URL } from 'url';

// Helper to ask question
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

async function main(): Promise<void> {
  console.log('=== GLPI OAuth Setup Helper ===');
  console.log('This script will help you generate an OAuth Access Token for your GLPI MCP Server.');
  console.log('\nPrerequisites:');
  console.log('1. Go to GLPI > Setup > OAuth API Applications.');
  console.log('2. Create an Application (or use existing).');
  console.log(
    '3. **IMPORTANT**: Add "http://localhost:3999/callback" to the "Redirect URIs".'
  );
  console.log('4. Ensure "Enable for API" is checked in the OAuth Plugin settings.');
  console.log('--------------------------------------------------\n');

  const glpiUrl = (await ask('Enter your GLPI URL (e.g. http://10.0.5.56): ')).replace(/\/$/, '');
  const clientId = await ask('Enter Client ID: ');
  const clientSecret = await ask('Enter Client Secret: ');

  // Authorization URL (Standard GLPI OAuth Plugin path)
  const authUrl = `${glpiUrl}/plugins/oauth2/index.php/authorize?response_type=code&client_id=${clientId}&redirect_uri=http://localhost:3999/callback&scope=api`;

  console.log('\nPlease open the following URL in your browser to authorize:');
  console.log('\x1b[36m%s\x1b[0m', authUrl);
  console.log('\nWaiting for callback on http://localhost:3999/callback ...');

  const server = http.createServer(
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!req.url) return;
      const url = new URL(req.url, 'http://localhost:3999');
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<h1>Authorization Successful!</h1><p>You can close this window and check your terminal.</p>'
          );
          server.close();

          console.log('\nAuthorization Code received!');
          console.log('Exchanging for Token...');

          try {
            const tokenResponse = await axios.post(
              `${glpiUrl}/plugins/oauth2/index.php/token`,
              new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: 'http://localhost:3999/callback',
              }),
              {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              }
            );

            const { access_token, refresh_token } = tokenResponse.data;

            console.log('\n=== SUCCESS ===');
            console.log('Please add the following to your MCP Client configuration:');
            console.log('\n"env": {');
            console.log(`  "GLPI_API_URL": "${glpiUrl}/apirest.php",`);
            console.log(`  "GLPI_APP_TOKEN": "YOUR_APP_TOKEN",`);
            console.log(`  "GLPI_OAUTH_TOKEN": "${access_token}"`);
            console.log('}');
            console.log(
              '\n(Note: You may also need to implement token refresh in a production environment, but this Access Token will work for now until it expires.)'
            );
          } catch (err: unknown) {
            const detail =
              err instanceof Error
                ? (err as { response?: { data?: unknown } }).response?.data || err.message
                : String(err);
            console.error('Failed to exchange token:', detail);
          } finally {
            rl.close();
            process.exit(0);
          }
        } else {
          res.writeHead(400);
          res.end('No code returned');
        }
      }
    }
  );

  server.listen(3999);
}

main();
