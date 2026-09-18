'use client';

// What each feature says before it has anything in it.
//
// Kept together so the set stays consistent: the same voice, the same sketch
// shape, and the title icon matching that feature's sidebar icon. Each page
// supplies only the action, because only the page knows how to start one.

import {
  Activity,
  Archive,
  Box,
  Cloud,
  Cpu,
  Database,
  FileCode,
  FileImage,
  FileText,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Globe,
  HardDrive,
  Image,
  KeyRound,
  Laptop,
  Lock,
  Network,
  Package,
  PanelsTopLeft,
  Paperclip,
  Rocket,
  ScrollText,
  Server,
  ShieldCheck,
  Smartphone,
  Table2,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import { FeatureEmpty, MockWindow, type FeatureEmptyProps } from './feature-empty';

type Action = FeatureEmptyProps['action'];

// The overview section, not the top of the page: it is the part that says what
// each feature is for. Anchored in docs/index.html, which ships with this repo.
const DOCS = 'https://yashthakur1.github.io/bitroot-panel/#what-it-manages';

export function ServicesEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="services"
      icon={Server}
      title="Run apps as Services"
      description="Deploy a repository and keep it running. Each service gets a port, its own logs and, when you want one, a public URL."
      action={action}
      learnMore={DOCS}
      illustration={
        <MockWindow
          kind="Service"
          name="api-server"
          nameIcon={Server}
          status="Online"
          groups={[
            { label: 'Process', tiles: [Cpu, Activity] },
            { label: 'Network', tiles: [Globe, Lock] },
            { label: 'Logs', tiles: [ScrollText] },
          ]}
        />
      }
    />
  );
}

export function ProjectsEmpty() {
  return (
    <FeatureEmpty
      id="projects"
      icon={Box}
      title="Get organized with Projects"
      badge="Coming soon"
      // No create action on purpose: grouping does not exist yet, and a
      // "Create your first project" button that led nowhere would be a lie.
      description="Group the services, static sites, buckets and routes that make up one piece of work, rather than listing them by what runs them. Until then, everything deployed is on Services."
      action={{ label: 'Go to Services', href: '/dashboard', go: true }}
      illustration={
        <MockWindow
          kind="Project"
          name="Health Checks"
          nameIcon={Box}
          status="All services up"
          groups={[
            { label: 'Production', tiles: [Server, Globe, Database] },
            { label: 'Staging', tiles: [Server, Globe] },
            { label: 'Dev', tiles: [Server, Database] },
          ]}
        />
      }
    />
  );
}

export function StaticSitesEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="static-sites"
      icon={PanelsTopLeft}
      title="Publish Static sites"
      description="Serve a folder of HTML, CSS and assets from this machine, with its own domain and edge caching. Almost nothing to keep online."
      action={action}
      learnMore={DOCS}
      illustration={
        <MockWindow
          kind="Static site"
          name="docs"
          nameIcon={PanelsTopLeft}
          status="Published"
          groups={[
            { label: 'Files', tiles: [FileCode, FileImage, FileText] },
            { label: 'Domain', tiles: [Globe, ShieldCheck] },
            { label: 'Cache', tiles: [Zap] },
          ]}
        />
      }
    />
  );
}

export function StorageEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="storage"
      icon={HardDrive}
      title="Store files in Buckets"
      description="S3-compatible storage on this machine. Keep a bucket private, or publish it at its own URL with edge caching."
      action={action}
      learnMore="https://garagehq.deuxfleurs.fr/documentation/quick-start/"
      illustration={
        <MockWindow
          kind="Bucket"
          name="product-images"
          nameIcon={HardDrive}
          status="Public"
          groups={[
            { label: 'Images', tiles: [Image, Image, Image] },
            { label: 'Documents', tiles: [FileText, FileText] },
            { label: 'Archives', tiles: [Archive] },
          ]}
        />
      }
    />
  );
}

export function PipelinesEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="pipelines"
      icon={GitBranch}
      title="Deploy on every push with Pipelines"
      description="Connect a repository and a branch. Each push to it builds the code and deploys it to this machine."
      action={action}
      learnMore="https://docs.github.com/en/webhooks/about-webhooks"
      illustration={
        <MockWindow
          kind="Pipeline"
          name="main → production"
          nameIcon={GitBranch}
          status="Last run passed"
          groups={[
            { label: 'Push', tiles: [GitCommitHorizontal] },
            { label: 'Build', tiles: [Package, ScrollText] },
            { label: 'Deploy', tiles: [Rocket, Server] },
          ]}
        />
      }
    />
  );
}

export function GitConnectionsEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="git-connections"
      icon={Github}
      title="Connect your Git accounts"
      description="Deploy from private repositories and create webhooks without pasting a token every time."
      action={action}
      learnMore={DOCS}
      illustration={
        <MockWindow
          kind="Git account"
          name="github.com/you"
          nameIcon={Github}
          status="Connected"
          groups={[
            { label: 'Repositories', tiles: [FolderGit2, FolderGit2, FolderGit2] },
            { label: 'Webhooks', tiles: [Webhook] },
            { label: 'Keys', tiles: [KeyRound] },
          ]}
        />
      }
    />
  );
}

export function DatabasesEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="pocketbase-databases"
      icon={Database}
      title="Create project Databases"
      description="Each database gets its own collections, auth and file storage, with connection details ready to paste into your app."
      action={action}
      learnMore="https://pocketbase.io/docs/"
      illustration={
        <MockWindow
          kind="Database"
          name="orders"
          nameIcon={Database}
          status="Backed up nightly"
          groups={[
            { label: 'Collections', tiles: [Table2, Table2, Table2] },
            { label: 'Auth', tiles: [Users] },
            { label: 'Files', tiles: [Paperclip] },
          ]}
        />
      }
    />
  );
}

export function RoutesEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="routes"
      icon={Cloud}
      title="Publish services with Routes"
      description="Give a local port a public HTTPS hostname through Cloudflare Tunnel. No open ports, no certificates to renew."
      action={action}
      learnMore="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"
      illustration={
        <MockWindow
          kind="Route"
          name="blog.example.com"
          nameIcon={Globe}
          status="Healthy"
          // The order a request travels, matching the Status column on the
          // routes table once there is something in it.
          groups={[
            { label: 'DNS', tiles: [Globe] },
            { label: 'Tunnel', tiles: [Cloud, Lock] },
            { label: 'Service', tiles: [Server] },
          ]}
        />
      }
    />
  );
}

export function DevicesEmpty({ action }: { action?: Action }) {
  return (
    <FeatureEmpty
      id="devices"
      icon={Laptop}
      title="See every device on your Tailnet"
      description="The key works, but the tailnet has no devices yet. Install Tailscale on a machine and sign in with the same account, and it appears here."
      action={action}
      illustration={
        <MockWindow
          kind="Tailnet"
          name="your-tailnet"
          nameIcon={Network}
          status="3 online"
          groups={[
            { label: 'Servers', tiles: [Server, Server] },
            { label: 'Phones', tiles: [Smartphone] },
            { label: 'Laptops', tiles: [Laptop] },
          ]}
        />
      }
    />
  );
}
