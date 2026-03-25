import { closeRedis, connectRedis } from './redis.js';
import { createDocumentSyncService } from './doc-sync.js';

async function main() {
  const service = createDocumentSyncService();
  await connectRedis();
  try {
    await service.ensureSeedReposFromConfig();
    const repos = await service.listRepos();
    if (!repos.length) {
      console.log('[doc-sync] skipped: no repository configuration found');
      return;
    }

    const status = await service.runAll('cli');
    console.log(JSON.stringify(status, null, 2));
  } finally {
    await closeRedis();
  }
}

main().catch((error) => {
  console.error('[doc-sync] failed:', error.message);
  process.exit(1);
});
