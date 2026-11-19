export type Card = {
  id: string;
  front: string;
  back: string;
  due?: number;
  /** Review interval in days. */
  interval?: number;
  reviews?: number;
};

export type Question = {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  topic: string;
};

export type GuideImage = {
  id: string;
  name: string;
  data: string;
  width: number;
  height: number;
};

export const MAX_GUIDE_IMAGES = 6;
export const MAX_GUIDE_IMAGE_DATA = 120_000;
export const MAX_GUIDE_IMAGE_TOTAL = 320_000;
export const MAX_GUIDE_IMAGE_EDGE = 1600;
export const MAX_SYNCED_KIT_BYTES = 500_000;

export function isGuideImageData(data: string) {
  return data.length <= MAX_GUIDE_IMAGE_DATA && data.length % 4 === 0 &&
    /^\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(data);
}

export type Kit = {
  id: string;
  title: string;
  subject: string;
  color: string;
  source: string;
  summary: string;
  guide: string;
  guideImages?: GuideImage[];
  cards: Card[];
  questions: Question[];
  updatedAt: number;
  demo?: boolean;
  history?: { date: number; score: number; total: number }[];
};

const sampleTime = new Date('2026-11-19T08:00:00Z').getTime();

export const demoKits: Kit[] = [
  {
    id: 'demo-learning',
    title: 'The science of learning',
    subject: 'Psychology',
    color: '#a78bfa',
    demo: true,
    updatedAt: sampleTime,
    source: 'Matrix sample notes — authored educational example.\n\nRetrieval practice means bringing information to mind without looking at the answer. It strengthens long-term retention and reveals gaps. Feedback helps correct errors. Spacing distributes study over time instead of concentrating it into one sitting. Interleaving mixes related problem types so that learners practice choosing an appropriate strategy. It can feel harder than blocked practice. Elaborative explanation connects an idea to prior knowledge and explains why it works. Sleep supports memory consolidation. Familiarity with a page is not the same as being able to recall or apply its ideas. A useful study cycle is to learn a small section, close the notes, retrieve, check feedback, and revisit it later. These principles support learning but do not guarantee identical results for every person or subject.',
    summary: 'Learn how retrieval, spacing, and useful feedback turn a study session into lasting knowledge.',
    guide: `# The science of learning

## Recall before you reread
Retrieval practice is the act of bringing an idea to mind without looking at the answer. Close your notes and explain a concept, answer a question, or sketch a process from memory. Then check your work.

## Give memory some space
Distribute practice across several days. A later attempt may feel harder, but that effort can support durable learning. Revisit forgotten material sooner and confidently recalled material later.

## Mix related problems
Interleaving alternates related problem types. The learner must decide which method fits each question. Use enough initial instruction to understand each method before mixing them.

## Explain the connection
Ask “why?” and “how does this connect to what I know?” An example in your own words can expose a gap that rereading misses. Compare your explanation with a reliable source.

## Build a repeatable study cycle
Learn a small section, retrieve it without notes, check feedback, and schedule a later review. Protect time for sleep, which supports memory consolidation. Judge progress by what you can recall and apply.

Source: Matrix sample notes. This is an illustrative study kit, not an AI-generated analysis of your files.`,
    cards: [
      { id: 'learning-c1', front: 'What is retrieval practice?', back: 'Recalling information from memory without looking at the answer, then checking your response.' },
      { id: 'learning-c2', front: 'How does spaced practice differ from cramming?', back: 'Spaced practice distributes learning across separate sessions; cramming concentrates it into one short period.' },
      { id: 'learning-c3', front: 'What skill does interleaving encourage?', back: 'Choosing which strategy or concept applies to a problem, rather than repeating one known method.' },
      { id: 'learning-c4', front: 'Why should retrieval practice include feedback?', back: 'Feedback identifies errors and helps replace them with correct information.' },
      { id: 'learning-c5', front: 'Why can familiarity be misleading?', back: 'Recognizing a page or answer does not prove you can recall or apply the idea independently.' },
      { id: 'learning-c6', front: 'What is a practical four-step study cycle?', back: 'Learn a small section, retrieve without notes, check feedback, and revisit it later.' },
    ],
    questions: [
      { id: 'learning-q1', prompt: 'Which activity is retrieval practice?', options: ['Highlighting a definition', 'Explaining a concept with your notes closed', 'Reading the same page again', 'Copying a paragraph'], answer: 1, explanation: 'Explaining with notes closed requires recall. Highlighting, rereading, and copying can all occur without retrieving the idea from memory.', topic: 'Retrieval practice' },
      { id: 'learning-q2', prompt: 'Which plan best illustrates spacing?', options: ['Studying four hours just before a test', 'Reviewing only familiar ideas', 'Studying a topic on Monday, Wednesday, and Saturday', 'Reading notes without breaks'], answer: 2, explanation: 'Spacing separates practice into sessions over time, allowing later retrieval after a delay.', topic: 'Spaced practice' },
      { id: 'learning-q3', prompt: 'What makes interleaved practice useful?', options: ['Every question uses the same method', 'It removes the need for feedback', 'It guarantees practice feels easy', 'It requires choosing a suitable strategy'], answer: 3, explanation: 'Mixing related types makes learners discriminate between problems and select an approach. It may initially feel more difficult.', topic: 'Interleaving' },
      { id: 'learning-q4', prompt: 'After recalling an incorrect answer, what should you do?', options: ['Check feedback and correct the mistake', 'Repeat the incorrect answer', 'Stop reviewing the topic forever', 'Ignore the answer'], answer: 0, explanation: 'Feedback helps correct errors, which is why checking your response is a key part of retrieval practice.', topic: 'Feedback' },
      { id: 'learning-q5', prompt: 'Which is stronger evidence of understanding than familiarity?', options: ['Recognizing the textbook layout', 'Remembering the color of a highlight', 'Explaining and applying the idea without notes', 'Spending a long time on one page'], answer: 2, explanation: 'Independent explanation and application test your access to the knowledge, while familiarity can create an illusion of mastery.', topic: 'Metacognition' },
      { id: 'learning-q6', prompt: 'What role can sleep play in learning?', options: ['It replaces the need to study', 'It supports memory consolidation', 'It prevents all forgetting', 'It makes feedback unnecessary'], answer: 1, explanation: 'Sleep supports consolidation of memories. It complements learning and practice but does not replace them or eliminate forgetting.', topic: 'Memory' },
    ],
  },
  {
    id: 'demo-cell',
    title: 'Inside the living cell',
    subject: 'Biology',
    color: '#7fcaa8',
    demo: true,
    updatedAt: sampleTime,
    source: 'Matrix sample notes — authored educational example.\n\nCells are the basic units of life. Typical cells have a plasma membrane, cytoplasm, genetic material, and ribosomes; specialized cells can lose some components. The plasma membrane is selectively permeable and regulates movement into and out of the cell. Prokaryotic cells lack a membrane-bound nucleus. Typical eukaryotic cells have a nucleus and other membrane-bound organelles. The nucleus contains most of the DNA in a typical eukaryotic cell. Ribosomes synthesize proteins. Mitochondria are major sites of ATP production through aerobic cellular respiration in eukaryotic cells. Plant cells have cellulose cell walls; many plant cells contain chloroplasts, where photosynthesis occurs. Photosynthesis converts light energy into chemical energy. Diffusion is net movement down a concentration gradient. Osmosis is the net movement of water across a selectively permeable membrane. Active transport requires an energy input to move substances against their electrochemical gradients.',
    summary: 'Explore the structures that keep cells alive, from selective membranes to energy-producing organelles.',
    guide: `# Inside the living cell

## A shared foundation
Typical cells have a plasma membrane, cytoplasm, genetic material, and ribosomes; specialized cells can lose some components. These components help cells maintain internal conditions, store information, and build proteins.

## Two cellular plans
Prokaryotes lack a membrane-bound nucleus. Typical eukaryotic cells have a nucleus and membrane-bound organelles. Size alone is not a reliable way to classify every cell.

## Information becomes protein
The nucleus contains most of the DNA in a typical eukaryotic cell. Ribosomes synthesize proteins. Ribosomes are also present in prokaryotes, which have no nucleus.

## Energy and plant structures
Mitochondria are major sites of ATP production during aerobic cellular respiration. Chloroplasts in photosynthetic plant cells convert light energy into chemical energy. Plant cell walls contain cellulose.

## Crossing the membrane
Diffusion is net movement down a concentration gradient. Osmosis concerns water moving across a selectively permeable membrane. Active transport uses energy to move substances against their electrochemical gradients.

Source: Matrix sample notes. Use this kit to explore the study tools.`,
    cards: [
      { id: 'cell-c1', front: 'Which four components are shared by typical cells?', back: 'A plasma membrane, cytoplasm, genetic material, and ribosomes.' },
      { id: 'cell-c2', front: 'What distinguishes prokaryotic cells from eukaryotic cells?', back: 'Prokaryotes lack a membrane-bound nucleus; typical eukaryotic cells have a nucleus and membrane-bound organelles.' },
      { id: 'cell-c3', front: 'What is the function of ribosomes?', back: 'Ribosomes synthesize proteins.' },
      { id: 'cell-c4', front: 'What is a major function of mitochondria?', back: 'Producing ATP through aerobic cellular respiration in eukaryotic cells.' },
      { id: 'cell-c5', front: 'What is osmosis?', back: 'The net movement of water across a selectively permeable membrane.' },
      { id: 'cell-c6', front: 'How does active transport differ from diffusion?', back: 'Active transport requires energy to move substances against an electrochemical gradient; diffusion moves them down a concentration gradient.' },
    ],
    questions: [
      { id: 'cell-q1', prompt: 'Which structure is present in both prokaryotic and eukaryotic cells?', options: ['Nucleus', 'Chloroplast', 'Mitochondrion', 'Ribosome'], answer: 3, explanation: 'Typical cells of both groups contain ribosomes for protein synthesis. Prokaryotes lack a membrane-bound nucleus and other membrane-bound organelles.', topic: 'Cell structure' },
      { id: 'cell-q2', prompt: 'Which description fits the plasma membrane?', options: ['An impermeable barrier', 'A selectively permeable boundary', 'The main storage site for DNA', 'A protein-producing organelle'], answer: 1, explanation: 'The plasma membrane regulates movement into and out of the cell, allowing some substances to cross more readily than others.', topic: 'Membranes' },
      { id: 'cell-q3', prompt: 'Which organelle is a major site of aerobic ATP production?', options: ['Mitochondrion', 'Nucleus', 'Ribosome', 'Cell wall'], answer: 0, explanation: 'Mitochondria carry out key processes of aerobic cellular respiration that generate ATP.', topic: 'Cellular energy' },
      { id: 'cell-q4', prompt: 'What moves across a selectively permeable membrane during osmosis?', options: ['Only proteins', 'DNA', 'Water', 'Only oxygen'], answer: 2, explanation: 'Osmosis refers specifically to the net movement of water across a selectively permeable membrane.', topic: 'Transport' },
      { id: 'cell-q5', prompt: 'Which process requires energy input to move against a gradient?', options: ['Simple diffusion', 'Active transport', 'Osmosis', 'Passive transport'], answer: 1, explanation: 'Active transport requires an energy input to move a substance against its electrochemical gradient.', topic: 'Transport' },
      { id: 'cell-q6', prompt: 'Where does photosynthesis occur in a photosynthetic plant cell?', options: ['Nucleus', 'Cell wall', 'Ribosome', 'Chloroplast'], answer: 3, explanation: 'Chloroplasts capture light energy and convert it into chemical energy through photosynthesis.', topic: 'Plant cells' },
    ],
  },
  {
    id: 'demo-motion',
    title: 'A universe of motion',
    subject: 'Physics',
    color: '#e3b972',
    demo: true,
    updatedAt: sampleTime,
    source: 'Matrix sample notes — authored educational example.\n\nIn classical mechanics, displacement is change in position and has direction. Average velocity equals displacement divided by elapsed time. Speed is a scalar, while velocity is a vector. Acceleration is the rate of change of velocity and can reflect changes in speed, direction, or both. Newton’s first law states that an object remains at rest or in uniform straight-line motion unless a net external force acts. For constant mass, Newton’s second law is F_net = ma. Newton’s third law describes equal and opposite interaction forces acting on two different bodies. Near Earth’s surface, the magnitude of gravitational acceleration is approximately 9.8 m/s² when air resistance is neglected. Mass is measured in kilograms; weight is a gravitational force measured in newtons. A free-falling object accelerates downward even while it is moving upward after being thrown.',
    summary: 'Connect forces, velocity, and acceleration to understand how objects move and why their motion changes.',
    guide: `# A universe of motion

## Describe a change in position
Displacement is the change in position, including direction. Average velocity equals displacement divided by elapsed time. Distance and displacement can differ when a path changes direction.

## Speed is not velocity
Speed is a scalar: it describes how fast. Velocity also includes direction. An object moving around a circle can have constant speed while its velocity changes.

## Acceleration means change
Acceleration is the rate of change of velocity. A change in speed, direction, or both produces acceleration. It is measured in metres per second squared.

## Forces explain motion
Newton’s first law concerns motion with zero net external force. For constant mass, the second law is F_net = ma. Third-law forces act on different bodies, so they do not cancel as forces on one object.

## Gravity and free fall
Near Earth’s surface, free-fall acceleration is approximately 9.8 m/s² downward, neglecting air resistance. Mass is measured in kilograms; weight is a gravitational force measured in newtons. A thrown ball accelerates downward even as it travels upward.

Source: Matrix sample notes. These statements use the classical, near-Earth model described above.`,
    cards: [
      { id: 'motion-c1', front: 'How is average velocity calculated?', back: 'Average velocity equals displacement divided by elapsed time.' },
      { id: 'motion-c2', front: 'What is the difference between speed and velocity?', back: 'Speed is a scalar. Velocity includes both magnitude and direction.' },
      { id: 'motion-c3', front: 'Can an object accelerate at constant speed?', back: 'Yes. A change in direction changes velocity, so motion around a circle at constant speed involves acceleration.' },
      { id: 'motion-c4', front: 'What does F_net = ma describe?', back: 'For constant mass, net force equals mass times acceleration: Newton’s second law.' },
      { id: 'motion-c5', front: 'Why do Newton’s third-law forces not cancel on one object?', back: 'The equal and opposite interaction forces act on two different objects.' },
      { id: 'motion-c6', front: 'How do mass and weight differ?', back: 'Mass is measured in kilograms. Weight is the gravitational force on an object and is measured in newtons.' },
    ],
    questions: [
      { id: 'motion-q1', prompt: 'An object moves 20 m east in 4 s. What is its average velocity?', options: ['5 m/s east', '80 m/s east', '5 m/s² east', '16 m/s east'], answer: 0, explanation: 'Average velocity is displacement divided by time: 20 m / 4 s = 5 m/s east.', topic: 'Velocity' },
      { id: 'motion-q2', prompt: 'A car moves around a circle at constant speed. Is it accelerating?', options: ['No, because speed is constant', 'Yes, because direction changes', 'Only if it stops', 'Only if its mass changes'], answer: 1, explanation: 'Velocity includes direction. The changing direction produces acceleration even when speed stays constant.', topic: 'Acceleration' },
      { id: 'motion-q3', prompt: 'What net force accelerates a 2 kg object at 3 m/s²?', options: ['1.5 N', '5 N', '6 N', '9 N'], answer: 2, explanation: 'Newton’s second law gives F_net = ma = 2 kg × 3 m/s² = 6 N.', topic: 'Newton’s laws' },
      { id: 'motion-q4', prompt: 'With zero net external force, an object already moving will…', options: ['Immediately stop', 'Continuously speed up', 'Always move in a circle', 'Keep a constant velocity'], answer: 3, explanation: 'Newton’s first law predicts uniform straight-line motion, meaning constant velocity, when the net external force is zero.', topic: 'Newton’s laws' },
      { id: 'motion-q5', prompt: 'A ball travels upward after being thrown. Neglecting air resistance, its acceleration is…', options: ['Upward', 'Downward', 'Zero until it reaches the top', 'Always along its velocity'], answer: 1, explanation: 'Near Earth’s surface gravity accelerates the ball downward throughout free flight, including while it moves upward and at its highest point.', topic: 'Gravity' },
      { id: 'motion-q6', prompt: 'Which statement correctly distinguishes mass and weight?', options: ['Both are measured in kilograms', 'Mass is a force; weight is not', 'Mass is measured in kilograms; weight in newtons', 'Weight cannot change with gravity'], answer: 2, explanation: 'Mass is measured in kilograms. Weight is gravitational force, measured in newtons, and changes when gravitational field strength changes.', topic: 'Mass and weight' },
    ],
  },
];

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`${name} has an unsupported format.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`${name} must be ${allowEmpty ? 'text' : 'non-empty text'} of at most ${max.toLocaleString()} characters.`);
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  const id = text(value, name, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${name} contains unsupported characters.`);
  return id;
}

function number(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${name} must be a valid non-negative number.`);
  return value;
}

function list(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} must be a list with at most ${max} items.`);
  return value;
}

/** Creates a new object from known fields only; unknown imported properties are never copied. */
export function validateKit(input: unknown): Kit {
  const item = record(input, 'Study kit');
  const cards: Card[] = list(item.cards, 'Flashcards', 300).map((raw, index) => {
    const card = record(raw, `Flashcard ${index + 1}`);
    const result: Card = {
      id: identifier(card.id, 'Flashcard ID'),
      front: text(card.front, 'Flashcard question', 4000),
      back: text(card.back, 'Flashcard answer', 12000),
    };
    if (card.due !== undefined) result.due = number(card.due, 'Review date');
    if (card.interval !== undefined) result.interval = number(card.interval, 'Review interval', 3650);
    if (card.reviews !== undefined) {
      result.reviews = number(card.reviews, 'Review count', 1000000);
      if (!Number.isInteger(result.reviews)) throw new Error('Review count must be a whole number.');
    }
    return result;
  });
  if (new Set(cards.map(card => card.id)).size !== cards.length) throw new Error('Flashcard IDs must be unique.');
  const questions: Question[] = list(item.questions, 'Questions', 300).map((raw, index) => {
    const question = record(raw, `Question ${index + 1}`);
    const options = list(question.options, 'Answer choices', 8).map(value => text(value, 'Answer choice', 4000));
    if (options.length < 2) throw new Error('Every question needs at least two answer choices.');
    const answer = number(question.answer, 'Correct answer', options.length - 1);
    if (!Number.isInteger(answer)) throw new Error('Correct answer must refer to one answer choice.');
    return {
      id: identifier(question.id, 'Question ID'),
      prompt: text(question.prompt, 'Question', 8000),
      options,
      answer,
      explanation: text(question.explanation, 'Explanation', 12000),
      topic: text(question.topic, 'Topic', 200),
    };
  });
  if (new Set(questions.map(question => question.id)).size !== questions.length) throw new Error('Question IDs must be unique.');
  const color = text(item.color, 'Color', 7);
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Color must be a six-digit hex color.');
  const kit: Kit = {
    id: identifier(item.id, 'Study kit ID'),
    title: text(item.title, 'Title', 200),
    subject: text(item.subject, 'Subject', 100),
    color,
    source: text(item.source, 'Source material', 200000, true),
    summary: text(item.summary, 'Summary', 10000, true),
    guide: text(item.guide, 'Study guide', 100000, true),
    cards,
    questions,
    updatedAt: number(item.updatedAt, 'Updated date'),
  };
  if (item.guideImages !== undefined) {
    const images = list(item.guideImages, 'Guide images', MAX_GUIDE_IMAGES).map(raw => {
      const image = record(raw, 'Guide image');
      const data = text(image.data, 'Image data', MAX_GUIDE_IMAGE_DATA);
      const width = number(image.width, 'Image width', MAX_GUIDE_IMAGE_EDGE);
      const height = number(image.height, 'Image height', MAX_GUIDE_IMAGE_EDGE);
      if (!isGuideImageData(data) || width < 1 || height < 1 || !Number.isInteger(width) || !Number.isInteger(height)) {
        throw new Error('This guide contains an invalid image.');
      }
      return {id: identifier(image.id, 'Image ID'), name: text(image.name, 'Image name', 160), data, width, height};
    });
    if (new Set(images.map(image => image.id)).size !== images.length ||
        images.reduce((total, image) => total + image.data.length, 0) > MAX_GUIDE_IMAGE_TOTAL) {
      throw new Error('This guide contains too much image data or duplicate images.');
    }
    if (images.length) kit.guideImages = images;
  }
  if (item.demo !== undefined) {
    if (typeof item.demo !== 'boolean') throw new Error('Sample status must be true or false.');
    kit.demo = item.demo;
  }
  if (item.history !== undefined) {
    kit.history = list(item.history, 'Test history', 1000).map(raw => {
      const entry = record(raw, 'Test result');
      const total = number(entry.total, 'Question total', 300);
      const score = number(entry.score, 'Score', total);
      if (total < 1 || !Number.isInteger(total) || !Number.isInteger(score)) throw new Error('Test scores must be whole numbers with a positive total.');
      return { date: number(entry.date, 'Test date'), score, total };
    });
  }
  if (JSON.stringify(kit).length > 450000) throw new Error('This study kit is too large. Keep it under 450,000 characters.');
  return kit;
}

export function reviewCard(card: Card, rating: 'again' | 'good' | 'easy', now = Date.now()): Card {
  if (!['again', 'good', 'easy'].includes(rating)) throw new Error('Choose a valid review rating.');
  const previous = Math.max(0, Number.isFinite(card.interval) ? card.interval! : 0);
  const interval = rating === 'again' ? 1 / 1440 : rating === 'good' ? Math.max(1, previous * 2.2) : Math.max(3, previous * 3);
  const capped = Math.min(365, interval);
  return { ...card, interval: capped, due: now + Math.round(capped * 86400000), reviews: (card.reviews ?? 0) + 1 };
}

/** Mastery reflects demonstrated spacing, reaching 100% at a 21-day interval. */
export function mastery(kit: Kit): number {
  if (!kit.cards.length) return 0;
  return Math.round(100 * kit.cards.reduce((sum, card) => sum + (card.reviews ? Math.min(1, Math.max(0, card.interval ?? 0) / 21) : 0), 0) / kit.cards.length);
}

export function dueCards(kit: Kit, now = Date.now()): Card[] {
  return kit.cards.filter(card => card.due === undefined || card.due <= now).sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
}

export function formatRelative(ts: number): string {
  const elapsed = Math.max(0, Date.now() - ts);
  if (elapsed < 60000) return 'just now';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`;
  if (elapsed < 604800000) return `${Math.floor(elapsed / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
