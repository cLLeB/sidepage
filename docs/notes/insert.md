# Insert pictures, tables and diagrams

Everything you can put into a note is under **+** (Insert) in the note's bar. It goes where the cursor is.

## A picture

1. Put the cursor where the picture should go.
2. Click **+**, then **Picture**.
3. Pick a picture from your device.

You can also paste a picture (<kbd>Ctrl</kbd> <kbd>V</kbd>) or drag one in. To put a part of the book's page into your notes, see [Clips](/notes/quotes-and-clips#clip-a-picture-from-the-page).

## A table

1. Click **+**, then **Table**.
2. Type in the cells. <kbd>Tab</kbd> moves to the next cell.
3. To add or remove rows and columns, click in the table and use the buttons that appear at its edges.

## A dividing line, today's date, a symbol

Click **+**, then:

- **Dividing line**
- **Today's date**, written out in full
- a **symbol** from the grid: arrows, ≈ ≠ ≤ ≥ ± × ÷ √ ∞ ∑ ∆ π µ θ λ Ω °, fractions, powers, currency, ✓ ✗ ★ and more

## A diagram, drawn from text

Sidepage draws flowcharts, timelines, mind maps, sequences of steps and pie charts from a few lines of text (using Mermaid).

1. Click **+**, then under **Diagrams (drawn from a few lines of text)**, pick **Flowchart**, **Timeline**, **Mind map**, **Sequence of steps** or **Pie chart**.
2. An example appears with its drawing under it.
3. Change the words in the example. The drawing follows as you type.

For example, this text:

```
flowchart LR
  Diffusion --> Mixing
  Convection --> Mixing
```

draws three boxes with arrows from Diffusion and Convection to Mixing. Every kind of diagram is described at [mermaid.js.org](https://mermaid.js.org/intro/).

## A graph, a molecule or sums, drawn from text

Three more things Sidepage draws from a few lines you type. Click **+**, then under **Graphs, molecules and sums**, pick one. An example appears with its drawing; change the lines and the drawing follows. To see the lines again, click the drawing.

### Graph of a formula

One formula per line, in `x`. Each is drawn on the same axes, which you can drag and zoom.

```plot
y = sin(x)
y = x^2 / 4
```

Write powers with `^`, and use `sqrt(x)`, `exp(x)`, `log(x)`, `abs(x)`, `sin`, `cos`, `tan`. Drawn with [function-plot](https://github.com/mauriciopoppe/function-plot).

### Molecule

A molecule written in SMILES, the way chemistry databases write structures, is drawn as its skeletal formula. One molecule per line.

```smiles
CC(=O)Oc1ccccc1C(=O)O
```

That is aspirin. To find the SMILES of any molecule, search for it on [PubChem](https://pubchem.ncbi.nlm.nih.gov) and copy the line marked **SMILES**. Drawn with [SmilesDrawer](https://github.com/reymond-group/smilesDrawer).

### Sums and units

One sum per line; each answer appears beside it. Units are understood and converted, and a name you give a value can be used in the lines after it.

```calc
# a line starting with # is a note
2.5 kg * 9.81 m/s^2
5 cm to inch
speed = 120 km/h
speed * 2.5 h
sqrt(2) * 3
```

gives `24.525 N`, `1.968503937 inch`, `300 km` and `4.242640687`. Worked out with [math.js](https://mathjs.org).

### Code you can run

A block marked `python` or `javascript` shows its code with **▶ Run**. Click it: what the code prints shows under it, and for Python, any matplotlib figure too.

```python
import math
for n in range(1, 6):
    print(n, math.factorial(n))
```

Python runs on your device (Pyodide); the first time, it is fetched (about 10 MB). JavaScript runs apart from your notes and stops after ten seconds.

### Algebra

A block marked `algebra` works out each line, written as mathematics:

```algebra
solve(x^2 - 5x + 6, x)
diff(x^3 * sin(x), x)
integrate(x * e^x, x)
factor(x^2 - 9)
```

It knows `solve`, `diff`, `integrate`, `factor`, `expand` and `simplify` (nerdamer).

### A chart from a table

A block marked `chart`: a first line naming the columns, then a line for each row. The first column runs along the bottom; the next one is drawn as bars and any others as lines. Start with `pie` and a title for a pie chart.

```chart
Year, Sales, Costs
2022, 120, 90
2023, 180, 110
```

### Music

A block marked `music` holds a tune in ABC notation; it is drawn as a score, with **▶ Play**.

### Geometry you can drag

A block marked `geometry`: points such as `A = (0, 0)`, then `line A B`, `segment A B`, `triangle A B C`, `polygon A B C D`, `circle A 2`, `circle A B`, `angle A B C` or a graph `y = sin(x)`. Drag the points and everything built on them follows (JSXGraph).

### A molecule by its name

In a `smiles` or `molecule` block, write a name such as `caffeine` or `aspirin` instead of SMILES: its structure is fetched from PubChem and drawn.

## A layout for your notes

Ready made page layouts for study notes:

1. Click **+**, then under **Layouts**, pick:
   - **Cornell notes**: Cues and questions, Notes, and a Summary
   - **Question and answer**: `Q:` and `A:` lines, which become [flashcards](/study/flashcards)
   - **Chapter summary**: Main idea, Key points, and What I still do not understand
   - **Key terms**: a table of terms and their meanings

## A link to the page of the book

**+**, then **Link to this page of the book** adds a link to where the book is open now. Click the link later to go straight back to that page.

## A link to another book's notes

- **+**, then under **Link to another book's notes**, pick the book.
- Or type `[[` in the note: a list of your books appears. Use the arrow keys and <kbd>Enter</kbd>, or click one.

Clicking the link opens that book with its notes. See [Links between notes and the graph](/notes/links-and-graph).

## Formulas

Type a formula between dollar signs, such as `$E = mc^2$` for a formula in the line, or `$$ … $$` on a line of its own for a formula set apart. It is drawn as you type (using KaTeX).
