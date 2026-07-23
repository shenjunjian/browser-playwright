import type { SelectorRoot } from "../vendor/injected/selectorEngine";

/** Collect elements matching CSS, optionally piercing open shadow roots. */
export function queryCSS(
  root: SelectorRoot,
  css: string,
  pierceShadow = true,
): Element[] {
  const result: Element[] = [];
  const visit = (scope: ParentNode) => {
    try {
      result.push(...Array.from(scope.querySelectorAll(css)));
    } catch {
      // Invalid CSS for native engine — skip.
    }
    if (!pierceShadow) return;
    const all = scope.querySelectorAll("*");
    for (const el of all) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return result;
}

export function queryXPath(root: SelectorRoot, expression: string): Element[] {
  const doc =
    root.nodeType === Node.DOCUMENT_NODE
      ? (root as Document)
      : root.ownerDocument;
  if (!doc) return [];
  const context =
    root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : (root as Node);
  const nodes: Element[] = [];
  try {
    const result = doc.evaluate(
      expression,
      context,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node && node.nodeType === Node.ELEMENT_NODE)
        nodes.push(node as Element);
    }
  } catch {
    // Invalid xpath
  }
  return nodes;
}

/** Stable document order for or-union. */
export function sortInDOMOrder(elements: Iterable<Element>): Element[] {
  return [...elements].sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}
