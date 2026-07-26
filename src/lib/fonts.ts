import localFont from 'next/font/local'
import { Space_Grotesk } from 'next/font/google'

// PPNeueMontreal from Pangram Pangram Foundry
export const ppNeueMontreal = localFont({
  src: [
    {
      path: '../../public/fonts/PPNeueMontreal-Variable.woff2',
      style: 'normal',
    },
    {
      path: '../../public/fonts/PPNeueMontreal-Italic.woff2',
      style: 'italic',
    },
  ],
  variable: '--font-pp-neue-montreal',
  display: 'swap',
})

// For Roobert, we'll use Space Grotesk as a temporary replacement
// Space Grotesk has similar geometric characteristics to Roobert
export const roobert = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-roobert',
  display: 'swap',
})
