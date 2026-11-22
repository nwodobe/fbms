@echo off
REM Rapport hebdomadaire de l'Observatoire AFLP : semaine ISO precedente, extraction en lecture seule.
cd /d "%~dp0"
python -m unittest discover -s tests
if errorlevel 1 (
  echo Les tests du moteur echouent : rapport NON genere.
  pause
  exit /b 1
)
python generer_rapport.py %*
echo.
echo Fichiers produits dans le dossier "sorties".
pause
