"use client";

import { ProjectsEmpty } from './feature-empties';

// Projects do not exist yet. The placeholder says so plainly and sends people to
// Services, where everything deployed actually lives, so the page reads as
// unfinished rather than broken.
export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-display font-light tracking-tight">Projects</h1>
      <ProjectsEmpty />
    </div>
  );
}
