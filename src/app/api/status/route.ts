import { NextResponse } from 'next/server';
import { snapshot } from '../../../features/crm';
import { browserStatus } from '../../../integrations/browser';
import { createHash } from 'node:crypto';
import release from '../../../../release.json';
import {reloadIntegrationEnv} from '../../../lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  reloadIntegrationEnv();
  let installationPath=process.cwd().replaceAll('\\','/').replace(/\/$/,'');
  if(process.platform==='win32')installationPath=installationPath.toLowerCase();
  const installationId=createHash('sha256').update(installationPath).digest('hex').slice(0,20);
  return NextResponse.json({ ...snapshot(), installationId, appVersion:release.version, browserConnected: await browserStatus() }, { headers: { 'Cache-Control': 'no-store' } });
}
