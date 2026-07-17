import { Global, Module } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { AppConfigService, REPO_ROOT } from './app-config.service';

// Load repo-root .env before AppConfigService validates process.env.
loadDotenv({ path: [resolve(REPO_ROOT, '.env.local'), resolve(REPO_ROOT, '.env')] });

@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
