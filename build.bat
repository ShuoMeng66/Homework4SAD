@echo off
chcp 65001 >nul
rem 用 XeLaTeX 编译两遍以生成目录
xelatex -interaction=nonstopmode report.tex
xelatex -interaction=nonstopmode report.tex
echo.
echo Done. Output: report.pdf
pause
