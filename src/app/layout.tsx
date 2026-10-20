import type { Metadata } from 'next';
import { PLATFORM_NAME } from '../lib/brand';
import './globals.css';
import 'leaflet/dist/leaflet.css';
export const metadata: Metadata = { title: `${PLATFORM_NAME} • Prospecção inteligente`, description: 'Pesquisa de empresas, prospecção e conversas comerciais com agentes de IA.', icons: {icon:'/brand/prospecta-ai-monogram.png',apple:'/brand/prospecta-ai-monogram.png'} };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
