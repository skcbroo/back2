import { exec } from 'child_process';

exec('npx prisma generate', (err, stdout, stderr) => {
  if (err) {
    console.error(`Erro: ${err.message}`);
    return;
  }
  if (stderr) console.error(`stderr: ${stderr}`);
  console.log(`stdout: ${stdout}`);
});
