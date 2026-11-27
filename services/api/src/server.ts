import { buildApp } from './app.js';
import { idVerifierFromEnv } from './idVerifier.js';

const app = buildApp({ idVerifier: idVerifierFromEnv(), state: process.env.LAUNCH_STATE ?? 'MA' });
const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Budbroz API listening on http://localhost:${port}`);
});
