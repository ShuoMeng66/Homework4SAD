"""Render the numbered PlantUML sources to vector PDFs and clean build files."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
FIGURES = ROOT / 'figures'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', type=Path, default=Path(os.environ.get(
        'PLANTUML_JAR', str(Path.home()/'.cache/homework4sad-tools/plantuml.jar'))))
    args = parser.parse_args()
    if not args.jar.is_file():
        raise SystemExit('Set PLANTUML_JAR or pass --jar with the path to plantuml.jar.')
    sources = sorted(FIGURES.glob('[0-9][0-9]_*.puml'))
    if len(sources) != 18:
        raise SystemExit(f'Expected 18 numbered sources; found {len(sources)}.')
    java, node = shutil.which('java'), shutil.which('node')
    if not java or not node:
        raise SystemExit('Java and Node.js must be available on PATH.')
    with tempfile.TemporaryDirectory(prefix='homework4sad-figures-') as temporary:
        build = Path(temporary)
        subprocess.run([java, '-DPLANTUML_LIMIT_SIZE=32768', '-jar', str(args.jar),
                        '-charset', 'UTF-8', '-tsvg', '-o', str(build),
                        *map(str, sources)], check=True, cwd=ROOT)
        svgs = sorted(build.glob('*.svg'))
        if len(svgs) != len(sources):
            raise SystemExit('One or more diagrams failed to render.')
        for svg in svgs:
            text = svg.read_text(encoding='utf-8')
            if 'Syntax Error' in text or 'is ignored:' in text:
                raise SystemExit(f'PlantUML reported a rendering problem in {svg.name}.')
        subprocess.run([node, str(ROOT/'render_figure_pdfs.cjs'), str(build),
                        str(FIGURES)], check=True, cwd=ROOT)
    print('Exported 18 vector PDFs. Temporary build files removed.')


if __name__ == '__main__':
    main()
