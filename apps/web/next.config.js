/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const userSvc    = process.env.USER_SERVICE_URL    ?? 'http://localhost:3001';
    const bookingSvc = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3002';
    const cbtaSvc    = process.env.CBTA_SERVICE_URL    ?? 'http://localhost:3003';

    return [
      { source: '/svc/users/:path*',   destination: `${userSvc}/api/v1/:path*` },
      { source: '/svc/booking/:path*', destination: `${bookingSvc}/api/v1/:path*` },
      { source: '/svc/cbta/:path*',    destination: `${cbtaSvc}/api/v1/:path*` },
    ];
  },
};

module.exports = nextConfig;
