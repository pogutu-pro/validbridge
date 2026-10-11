/**
 * How many quiz questions a lesson's content holds, across every Quiz block.
 * Walks the document because authors nest blocks inside columns and callouts.
 * Zero means the lesson has no quiz yet.
 */
export function countQuizQuestions(content: unknown): number {
  let count = 0
  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') return
    if (node.type === 'blockQuiz' && Array.isArray(node.attrs?.questions)) {
      count += node.attrs.questions.length
    }
    walk(node.content)
  }
  walk(content)
  return count
}
