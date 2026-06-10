declare module 'react-cytoscapejs' {
  import * as React from 'react'
  import type cytoscape from 'cytoscape'

  export interface CytoscapeComponentProps extends React.HTMLAttributes<HTMLDivElement> {
    elements?: cytoscape.ElementDefinition[] | any
    stylesheet?: cytoscape.StylesheetCSS[] | any
    layout?: cytoscape.LayoutOptions | any
    style?: React.CSSProperties
    className?: string
    cy?: (cy: cytoscape.Core) => void
    [key: string]: any
  }

  const CytoscapeComponent: React.ComponentType<CytoscapeComponentProps>
  export default CytoscapeComponent
}

