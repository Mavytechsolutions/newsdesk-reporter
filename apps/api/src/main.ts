import 'reflect-metadata';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

export function configureApp(app: INestApplication) {
  // No HTTPS on the server yet: don't tell browsers to upgrade requests (it would break the newsroom page).
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } }, hsts: false }));
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: true });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'n/:slug', method: RequestMethod.GET },
      { path: 'media/:file', method: RequestMethod.GET },
      { path: 'newsroom', method: RequestMethod.GET },
      { path: 'newsroom/app.js', method: RequestMethod.GET },
      { path: 'admin', method: RequestMethod.GET },
      { path: 'admin/app.js', method: RequestMethod.GET },
      { path: 'fonts/:file', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(config.port);
  console.log(`✔ MAVY NEWS API running at http://localhost:${config.port}/api/v1/health`);
}

if (require.main === module) bootstrap();
