// The daily check-in's steps (Updates, Daily notes, Just finished), shown as a bar at the top of
// each of its pop-ups so you can tell where you are. Set by main.ts while a check-in runs.

export interface CheckInStep {
  name: string
  detail: string
  state: 'todo' | 'now' | 'done'
}

let steps: CheckInStep[] | null = null

/** A check-in starts: its three steps, the first under way. */
export function startCheckIn(): void {
  steps = [
    { name: '1 · Updates', detail: 'Routine updates', state: 'now' },
    { name: '2 · Daily notes', detail: 'Links to add', state: 'todo' },
    { name: '3 · Just finished', detail: 'To react to', state: 'todo' },
  ]
}

/** Moves the check-in on to step `index` (0–2), the ones before it done; `detail` says what's in it. */
export function checkInStep(index: number, detail?: string): void {
  if (!steps) return
  steps.forEach((step, i) => { step.state = i < index ? 'done' : i === index ? 'now' : 'todo' })
  if (detail) steps[index].detail = detail
}

export function endCheckIn(): void {
  steps = null
}

/** The step bar, when a check-in is under way (nothing otherwise). */
export function renderCheckInSteps(el: HTMLElement): void {
  if (!steps) return
  const bar = el.createDiv('pmn-steps')
  for (const step of steps) {
    const box = bar.createDiv({ cls: ['pmn-step', `is-${step.state}`] })
    box.createDiv({ cls: 'pmn-step-name', text: step.name })
    box.createDiv({ cls: 'pmn-step-detail', text: step.detail })
  }
}
