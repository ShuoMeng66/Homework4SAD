"""Export every native TikZ source as a standalone PDF in figures/."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
FIGURES = ROOT / 'figures'
BUILD = ROOT / 'tmp' / 'figure_pdfs'

PREAMBLE = r'''\documentclass[12pt,border=6pt]{standalone}
\usepackage[UTF8,fontset=windows]{ctex}
\usepackage{array,tikz}
\usetikzlibrary{calc,arrows.meta,fit,positioning}
\setlength{\parindent}{2em}
\setlength{\parskip}{0.35em}
\renewcommand{\arraystretch}{1.25}
\begin{document}
'''


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    sources = sorted(FIGURES.glob('*.tex'))
    if not sources:
        raise SystemExit('No TikZ sources found in figures/.')
    for source in sources:
        wrapper = BUILD / source.name
        wrapper.write_text(
            PREAMBLE + '\\input{' + source.as_posix() + '}\n\\end{document}\n',
            encoding='utf-8',
        )
        result = subprocess.run(
            ['xelatex', '-interaction=nonstopmode', '-halt-on-error', wrapper.name],
            cwd=BUILD, capture_output=True, text=True, encoding='utf-8', errors='replace',
        )
        if result.returncode:
            raise SystemExit(f'Failed to export {source.name}:\n{result.stdout[-4000:]}')
        shutil.copy2(wrapper.with_suffix('.pdf'), FIGURES / source.with_suffix('.pdf').name)
    print(f'Exported {len(sources)} standalone PDFs to figures/.')


if __name__ == '__main__':
    main()
