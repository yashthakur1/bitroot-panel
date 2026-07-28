import os from 'os';
import LoginForm from '@/components/login-form';

// Rendered per request, not at build time. Prerendering bakes in whichever
// machine ran the build - which is how the login screen ended up announcing the
// laptop that compiled it instead of the server actually answering.
export const dynamic = 'force-dynamic';

// The login screen is dark regardless of the theme the rest of the panel uses.
// The artwork only reads against deep space, and a half-lit version of it looks
// like a rendering bug rather than a preference.
export default function Home() {
  // The name the panel already uses in the URLs it hands out, so the login
  // screen agrees with everything else rather than inventing a second identity.
  const server = process.env.TAILNET_HOST?.split('.')[0] || os.hostname().split('.')[0];

  return <LoginForm server={server} />;
}
