import { NextResponse } from 'next/server';
import { snapshot } from '../../../features/crm';
import { browserStatus } from '../../../integrations/browser';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ...snapshot(), browserConnected: await browserStatus() }, { headers: { 'Cache-Control': 'no-store' } });
}
