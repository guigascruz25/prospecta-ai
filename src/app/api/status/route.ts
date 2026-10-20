import { NextResponse } from 'next/server';
import { snapshot } from '../../../features/crm';
import { browserStatus } from '../../../integrations/browser';
import { createHash } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  let installationPath=process.cwd().replaceAll('\\','/').replace(/\/$/,'');
  if(process.platform==='win32')installationPath=installationPath.toLowerCase();
  const installationId=createHash('sha256').update(installationPath).digest('hex').slice(0,20);
  return NextResponse.json({ ...snapshot(), installationId, browserConnected: await browserStatus() }, { headers: { 'Cache-Control': 'no-store' } });
}
